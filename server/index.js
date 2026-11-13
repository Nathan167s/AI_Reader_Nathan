import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import {
  ASSETS_DIR,
  BOOKS_DIR,
  DATA_DIR,
  FILES_DIR,
  NOTES_WORD_DIR,
  ROOT,
  bookFilePath,
  deleteBookFiles,
  ensureDirs,
  getBookContent,
  getLibrary,
  getMaps,
  getSettings,
  getThreads,
  getNotesData,
  saveNotesData,
  getConcepts,
  saveConcepts,
  newId,
  publicSettings,
  saveBookContent,
  saveLibrary,
  saveMaps,
  saveSettings,
  saveThreads,
  withLock,
} from './store.js';
import {
  ImportError,
  cleanTitle,
  importWebArticle,
  parsePastedContent,
  parseUpload,
} from './parsers.js';
import {
  retrieveContext,
  localAnswer,
  searchBook,
  searchLibrary,
  generateMindMap,
  reviseMindMap,
} from './retrieval.js';
import { callAI, resolveAi, testAIConnection } from './ai.js';
import { searchForQuestion } from './search.js';
import { buildNotesDocx } from './docx.js';
import { noteSummary, createNote, organizeBookNotes, groupNotesForExport } from './notes.js';
import { generateConceptTree, summarizeConcept, normalizeConceptRoot } from './concepts.js';
import { seedIfNeeded } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const DIST_DIR = path.join(ROOT, 'dist');
const ALLOWED_EXT = new Set(['.txt', '.md', '.markdown', '.pdf', '.docx', '.doc', '.html', '.htm', '.epub']);
const PALETTES = 6;

await ensureDirs();
await seedIfNeeded();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      const ms = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function paletteFor(title) {
  let hash = 0;
  for (const char of String(title)) hash = (hash * 31 + char.codePointAt(0)) % 100000;
  return hash % PALETTES;
}

function fixOriginalName(name = '') {
  if (!name) return '未命名';
  if (/[^\u0000-\u00ff]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (decoded && !decoded.includes('\uFFFD')) return decoded;
  } catch {
    // 保持原文件名
  }
  return name;
}

function makeBookMeta({ id, content, size, sourceFile = '', sourceUrl = '', sourceType }) {
  const now = new Date().toISOString();
  return {
    id,
    title: content.title,
    author: content.author || '',
    format: content.format,
    sourceType: sourceType || content.sourceType,
    sourceUrl: sourceUrl || content.sourceUrl || '',
    excerpt: content.excerpt,
    wordCount: content.wordCount,
    chapterCount: content.chapters.length,
    size: size || 0,
    sourceFile,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    progress: { chapterIndex: 0, ratio: 0, page: 1, updatedAt: now },
    palette: paletteFor(content.title),
    tags: content.sourceType === 'wechat' ? ['微信'] : [],
  };
}

function summarizeMap(map) {
  const count = (node) => 1 + (node.children || []).reduce((sum, child) => sum + count(child), 0);
  return {
    id: map.id,
    title: map.title,
    bookId: map.bookId || '',
    bookTitle: map.bookTitle || '',
    theme: map.theme || 'forest',
    scopeType: map.scopeType || 'book',
    scopeLabel: map.scopeLabel || '全书',
    chapterIndex: Number.isInteger(map.chapterIndex) ? map.chapterIndex : null,
    concept: map.concept || '',
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
    nodeCount: count(map.root || {}),
    preview: {
      root: map.root?.text || map.title,
      branches: (map.root?.children || []).slice(0, 6).map((child) => ({
        text: child.text,
        count: 1 + (child.children?.length || 0),
      })),
    },
  };
}

function normalizeMapRoot(root) {
  let total = 0;
  function walk(raw, depth) {
    if (depth > 8 || total >= 500) return null;
    const node = raw && typeof raw === 'object' ? raw : {};
    total += 1;
    const children = Array.isArray(node.children)
      ? node.children
          .slice(0, 12)
          .map((child) => walk(child, depth + 1))
          .filter(Boolean)
      : [];
    return {
      id:
        typeof node.id === 'string' && node.id
          ? node.id.slice(0, 40)
          : crypto.randomUUID().slice(0, 10),
      text:
        String(node.text || '新节点').replace(/\s+/g, ' ').trim().slice(0, 200) ||
        '新节点',
      note: String(node.note || '').slice(0, 1000),
      children,
    };
  }
  return (
    walk(root || { text: '新的思维导图', children: [] }, 0) || {
      id: crypto.randomUUID().slice(0, 10),
      text: '新的思维导图',
      note: '',
      children: [],
    }
  );
}

async function findBook(id) {
  const books = (await getLibrary()) || [];
  const book = books.find((item) => item.id === id);
  if (!book) fail(404, 'BOOK_NOT_FOUND', '书籍不存在或已被删除');
  return { book, books };
}

async function refreshNotesWord(bookId) {
  const books = (await getLibrary()) || [];
  const book = books.find((item) => item.id === bookId);
  const filePath = path.join(NOTES_WORD_DIR, `${bookId}.docx`);
  if (!book) return null;
  const data = await getNotesData();
  const notes = data.items.filter((note) => note.bookId === bookId);
  if (!notes.length) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    return null;
  }
  const grouped = groupNotesForExport(notes, data.analyses[bookId]);
  const buffer = await buildNotesDocx({
    bookTitle: book.title,
    notes: grouped.notes,
    overview: grouped.overview,
    categories: grouped.categories,
  });
  await fs.writeFile(filePath, buffer);
  return { buffer, filePath };
}

async function commitBook({ content, id, rawBuffer, filename, sourceType, sourceUrl }) {
  const safeFilename = fixOriginalName(filename);
  let sourceFile = '';
  if (rawBuffer) {
    const ext = path.extname(safeFilename).toLowerCase();
    sourceFile = `${id}${ext}`;
    await fs.writeFile(path.join(FILES_DIR, sourceFile), rawBuffer);
  }
  await saveBookContent(id, content);
  const meta = makeBookMeta({
    id,
    content,
    size: rawBuffer?.length || Buffer.byteLength(content.text, 'utf8'),
    sourceFile,
    sourceUrl,
    sourceType,
  });
  try {
    await withLock('library', async () => {
      const books = (await getLibrary()) || [];
      books.unshift(meta);
      await saveLibrary(books);
    });
  } catch (err) {
    await deleteBookFiles(id).catch(() => {});
    throw err;
  }
  return meta;
}

/* ------------------------------------------------------------------ */
/* 基础                                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'PageNest', time: new Date().toISOString() });
});

app.get(
  '/api/bootstrap',
  asyncRoute(async (_req, res) => {
    const [books, settings, threads, maps, notesData, concepts] = await Promise.all([
      getLibrary(),
      getSettings(),
      getThreads(),
      getMaps(),
      getNotesData(),
      getConcepts(),
    ]);
    res.json({
      books: books || [],
      settings: publicSettings(settings),
      threads: (threads || []).map((thread) => ({
        id: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        messageCount: thread.messages?.length || 0,
      })),
      maps: (maps || []).map(summarizeMap),
      concepts: (concepts || []).map(summarizeConcept),
      stats: {
        books: (books || []).length,
        words: (books || []).reduce((sum, book) => sum + (book.wordCount || 0), 0),
        maps: (maps || []).length,
        threads: (threads || []).length,
        notes: (notesData.items || []).length,
        concepts: (concepts || []).length,
        storage: (books || []).reduce((sum, book) => sum + (book.size || 0), 0),
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 导入                                                                 */
/* ------------------------------------------------------------------ */

app.post(
  '/api/books/upload',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(Object.assign(new Error('文件超过 60MB 限制'), { status: 413, code: 'FILE_TOO_LARGE' }));
      }
      return next(Object.assign(new Error(`上传失败：${err.message}`), { status: 400, code: 'UPLOAD_FAILED' }));
    });
  },
  asyncRoute(async (req, res) => {
    if (!req.file) fail(400, 'NO_FILE', '请选择要导入的文件');
    const filename = fixOriginalName(req.file.originalname);
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      fail(400, 'UNSUPPORTED_FORMAT', '暂不支持这个格式。支持 TXT、Markdown、PDF、Word、HTML、EPUB。');
    }
    const id = newId();
    let content;
    try {
      content = await parseUpload({ buffer: req.file.buffer, filename, bookId: id });
    } catch (err) {
      await fs.rm(path.join(ASSETS_DIR, id), { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    const meta = await commitBook({
      content,
      id,
      rawBuffer: req.file.buffer,
      filename,
      sourceType: ext === '.pdf' || ext === '.epub' ? 'upload' : 'upload',
    });
    res.status(201).json({ book: meta });
  }),
);

app.post(
  '/api/books/import-url',
  asyncRoute(async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!url) fail(400, 'INVALID_URL', '请粘贴网页链接');
    const id = newId();
    let content;
    try {
      content = await importWebArticle(url, { bookId: id });
    } catch (err) {
      await fs.rm(path.join(ASSETS_DIR, id), { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    const meta = await commitBook({
      content,
      id,
      sourceType: content.sourceType,
      sourceUrl: content.sourceUrl,
    });
    res.status(201).json({ book: meta });
  }),
);

app.post(
  '/api/books/import-paste',
  asyncRoute(async (req, res) => {
    const content = String(req.body?.content || '');
    if (content.trim().length > 4 * 1024 * 1024) fail(413, 'TOO_LARGE', '粘贴内容过大');
    const parsed = parsePastedContent({
      content,
      title: cleanTitle(req.body?.title || '', '粘贴的文章'),
      sourceUrl: String(req.body?.sourceUrl || ''),
      html: Boolean(req.body?.html),
    });
    const id = newId();
    const meta = await commitBook({
      content: { ...parsed, sourceType: 'paste' },
      id,
      sourceType: 'paste',
      sourceUrl: req.body?.sourceUrl || '',
    });
    res.status(201).json({ book: meta });
  }),
);

/* ------------------------------------------------------------------ */
/* 书籍                                                                 */
/* ------------------------------------------------------------------ */

app.get(
  '/api/books/:id/content',
  asyncRoute(async (req, res) => {
    const { book } = await findBook(req.params.id);
    const content = await getBookContent(book.id);
    if (!content) fail(404, 'CONTENT_NOT_FOUND', '书籍内容文件缺失');
    const chapters = content.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      html: content.format === 'pdf' ? '' : chapter.html,
      length: chapter.text?.length || 0,
    }));
    res.json({
      book,
      format: content.format,
      chapters,
      pdf:
        content.format === 'pdf'
          ? {
              pages: content.meta?.pages || content.chapters.length,
              textPages:
                content.meta?.textPages ??
                content.chapters.filter(
                  (chapter) => chapter.text && !chapter.text.includes('没有可提取的文字'),
                ).length,
            }
          : null,
      wordCount: content.wordCount,
    });
  }),
);

app.patch(
  '/api/books/:id',
  asyncRoute(async (req, res) => {
    const book = await withLock('library', async () => {
      const books = (await getLibrary()) || [];
      const target = books.find((item) => item.id === req.params.id);
      if (!target) fail(404, 'BOOK_NOT_FOUND', '书籍不存在或已被删除');
      if (typeof req.body?.title === 'string' && req.body.title.trim()) {
        target.title = cleanTitle(req.body.title.trim(), target.title);
      }
      if (typeof req.body?.author === 'string') {
        target.author = req.body.author.trim().slice(0, 80);
      }
      if (Array.isArray(req.body?.tags)) {
        target.tags = req.body.tags.map((tag) => String(tag).slice(0, 20)).slice(0, 8);
      }
      target.updatedAt = new Date().toISOString();
      await saveLibrary(books);
      return target;
    });
    const content = await getBookContent(book.id);
    if (content) {
      content.title = book.title;
      content.author = book.author;
      await saveBookContent(book.id, content);
    }
    res.json({ book });
  }),
);

app.patch(
  '/api/books/:id/progress',
  asyncRoute(async (req, res) => {
    const now = new Date().toISOString();
    const chapterIndex = Math.max(0, Number(req.body?.chapterIndex) || 0);
    const ratio = Math.min(1, Math.max(0, Number(req.body?.ratio) || 0));
    const page = Math.max(1, Number(req.body?.page) || 1);
    const progress = await withLock('library', async () => {
      const books = (await getLibrary()) || [];
      const book = books.find((item) => item.id === req.params.id);
      if (!book) fail(404, 'BOOK_NOT_FOUND', '书籍不存在或已被删除');
      book.progress = { chapterIndex, ratio, page, updatedAt: now };
      book.lastOpenedAt = now;
      await saveLibrary(books);
      return book.progress;
    });
    res.json({ progress });
  }),
);

app.delete(
  '/api/books/:id',
  asyncRoute(async (req, res) => {
    await withLock('library', async () => {
      const books = (await getLibrary()) || [];
      if (!books.some((book) => book.id === req.params.id)) {
        fail(404, 'BOOK_NOT_FOUND', '书籍不存在或已被删除');
      }
      await saveLibrary(books.filter((book) => book.id !== req.params.id));
    });
    await deleteBookFiles(req.params.id);
    await withLock('maps', async () => {
      const maps = (await getMaps()) || [];
      let changed = false;
      const nextMaps = maps.map((map) => {
        if (map.bookId !== req.params.id) return map;
        changed = true;
        return { ...map, bookId: '', updatedAt: new Date().toISOString() };
      });
      if (changed) await saveMaps(nextMaps);
    });
    res.json({ ok: true });
  }),
);

app.get(
  '/api/books/:id/file',
  asyncRoute(async (req, res) => {
    const { book } = await findBook(req.params.id);
    const filePath = bookFilePath(book);
    if (!filePath) fail(404, 'FILE_NOT_FOUND', '这本书没有原始文件，可能来自网页导入');
    try {
      await fs.access(filePath);
    } catch {
      fail(404, 'FILE_NOT_FOUND', '原始文件已丢失');
    }
    const ext = path.extname(book.sourceFile || '').toLowerCase();
    const inline = ext === '.pdf';
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(book.title)}${ext}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (ext === '.html' || ext === '.htm' || ext === '.txt') {
      res.type('text/plain; charset=utf-8');
    }
    res.sendFile(filePath);
  }),
);

/* ------------------------------------------------------------------ */
/* 笔记                                                                 */
/* ------------------------------------------------------------------ */

app.get(
  '/api/books/:id/notes',
  asyncRoute(async (req, res) => {
    const { book } = await findBook(req.params.id);
    const data = await getNotesData();
    res.json({
      notes: data.items
        .filter((note) => note.bookId === book.id)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(noteSummary),
      analysis: data.analyses[book.id] || null,
    });
  }),
);

app.post(
  '/api/books/:id/notes',
  asyncRoute(async (req, res) => {
    const { book } = await findBook(req.params.id);
    const quote = String(req.body?.quote || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!quote && !content) fail(400, 'EMPTY_NOTE', '请写一点内容或摘录一段原文');
    const note = createNote(req.body || {}, book);
    await withLock('notes', async () => {
      const data = await getNotesData();
      data.items.unshift(note);
      delete data.analyses[book.id];
      await saveNotesData(data);
    });
    await refreshNotesWord(book.id).catch((err) => {
      console.warn('[notes-word]', err.message);
    });
    res.status(201).json({ note: noteSummary(note) });
  }),
);

app.patch(
  '/api/notes/:id',
  asyncRoute(async (req, res) => {
    const updated = await withLock('notes', async () => {
      const data = await getNotesData();
      const note = data.items.find((item) => item.id === req.params.id);
      if (!note) fail(404, 'NOTE_NOT_FOUND', '笔记不存在');
      if (typeof req.body?.quote === 'string') note.quote = req.body.quote.trim().slice(0, 4000);
      if (typeof req.body?.title === 'string') note.title = req.body.title.trim().slice(0, 160);
      if (typeof req.body?.content === 'string') note.content = req.body.content.trim().slice(0, 8000);
      if (typeof req.body?.category === 'string') note.category = req.body.category.trim().slice(0, 40) || '未分类';
      note.updatedAt = new Date().toISOString();
      delete data.analyses[note.bookId];
      await saveNotesData(data);
      return note;
    });
    await refreshNotesWord(updated.bookId).catch((err) => {
      console.warn('[notes-word]', err.message);
    });
    res.json({ note: noteSummary(updated) });
  }),
);

app.delete(
  '/api/notes/:id',
  asyncRoute(async (req, res) => {
    const removedBookId = await withLock('notes', async () => {
      const data = await getNotesData();
      const removed = data.items.find((item) => item.id === req.params.id);
      data.items = data.items.filter((item) => item.id !== req.params.id);
      if (removed) delete data.analyses[removed.bookId];
      await saveNotesData(data);
      return removed?.bookId || null;
    });
    if (removedBookId) {
      await refreshNotesWord(removedBookId).catch((err) => {
        console.warn('[notes-word]', err.message);
      });
    }
    res.json({ ok: true });
  }),
);

app.post(
  '/api/books/:id/notes/organize',
  asyncRoute(async (req, res) => {
    const { book } = await findBook(req.params.id);
    const result = await organizeBookNotes(book.id, book.title);
    const saved = await withLock('notes', async () => {
      const latest = await getNotesData();
      for (const note of result.data.items.filter((item) => item.bookId === book.id)) {
        const target = latest.items.find((item) => item.id === note.id);
        if (!target) continue;
        target.category = note.category;
        target.aiTitle = note.aiTitle;
        target.aiSummary = note.aiSummary;
        target.updatedAt = note.updatedAt;
      }
      latest.analyses[book.id] = result.analysis;
      await saveNotesData(latest);
      return latest;
    });
    await refreshNotesWord(book.id).catch((err) => {
      console.warn('[notes-word]', err.message);
    });
    res.json({
      notes: saved.items
        .filter((note) => note.bookId === book.id)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(noteSummary),
      analysis: saved.analyses[book.id] || result.analysis,
    });
  }),
);

app.get(
  '/api/books/:id/notes.docx',
  asyncRoute(async (req, res) => {
    const { book } = await findBook(req.params.id);
    const generated = await refreshNotesWord(book.id);
    if (!generated) fail(404, 'NO_NOTES', '这本书还没有笔记');
    const buffer = generated.buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}-读书笔记.docx`)}`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }),
);

/* ------------------------------------------------------------------ */
/* 搜索                                                                 */
/* ------------------------------------------------------------------ */

app.get(
  '/api/books/:id/search',
  asyncRoute(async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json({ hits: [], query: '' });
    const result = await searchBook(req.params.id, query);
    res.json(result);
  }),
);

app.get(
  '/api/search',
  asyncRoute(async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json({ books: [], hits: [], query: '' });
    const result = await searchLibrary(query);
    res.json(result);
  }),
);

/* ------------------------------------------------------------------ */
/* 设置                                                                 */
/* ------------------------------------------------------------------ */

app.get(
  '/api/settings',
  asyncRoute(async (_req, res) => {
    res.json(publicSettings(await getSettings()));
  }),
);

app.put(
  '/api/settings',
  asyncRoute(async (req, res) => {
    const next = await withLock('settings', async () => {
      const settings = await getSettings();
      const body = req.body || {};
      if (body.ai && typeof body.ai === 'object') {
        if (typeof body.ai.provider === 'string') settings.ai.provider = body.ai.provider.slice(0, 30);
        if (typeof body.ai.baseUrl === 'string' && body.ai.baseUrl.trim()) {
          settings.ai.baseUrl = body.ai.baseUrl.trim().slice(0, 300);
        }
        if (typeof body.ai.model === 'string' && body.ai.model.trim()) {
          settings.ai.model = body.ai.model.trim().slice(0, 100);
        }
        if (typeof body.ai.apiKey === 'string' && body.ai.apiKey.trim() && !body.ai.apiKey.includes('•')) {
          settings.ai.apiKey = body.ai.apiKey.trim().slice(0, 500);
        }
      }
      if (body.clearKey) settings.ai.apiKey = '';
      if (body.ui && typeof body.ui === 'object') {
        if (typeof body.ui.theme === 'string') settings.ui.theme = body.ui.theme.slice(0, 30);
      }
      await saveSettings(settings);
      return settings;
    });
    res.json(publicSettings(next));
  }),
);

app.post(
  '/api/ai/test',
  asyncRoute(async (_req, res) => {
    const result = await testAIConnection();
    res.json(result);
  }),
);

/* ------------------------------------------------------------------ */
/* 问答                                                                 */
/* ------------------------------------------------------------------ */

function publicThread(thread) {
  return {
    ...thread,
    messages: (thread.messages || []).map((message) => ({
      ...message,
      sources: (message.sources || []).map(({ text, ...source }) => source),
    })),
  };
}

app.get(
  '/api/threads',
  asyncRoute(async (_req, res) => {
    const threads = await getThreads();
    res.json(
      threads
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(publicThread),
    );
  }),
);

app.get(
  '/api/threads/:id',
  asyncRoute(async (req, res) => {
    const threads = await getThreads();
    const thread = threads.find((item) => item.id === req.params.id);
    if (!thread) fail(404, 'THREAD_NOT_FOUND', '对话不存在');
    res.json(publicThread(thread));
  }),
);

app.post(
  '/api/threads',
  asyncRoute(async (req, res) => {
    const now = new Date().toISOString();
    const thread = {
      id: newId(),
      title: cleanTitle(req.body?.title || '', '新对话'),
      bookIds: Array.isArray(req.body?.bookIds) ? req.body.bookIds.slice(0, 12) : [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await withLock('threads', async () => {
      const threads = await getThreads();
      threads.unshift(thread);
      await saveThreads(threads.slice(0, 100));
    });
    res.status(201).json(publicThread(thread));
  }),
);

app.patch(
  '/api/threads/:id',
  asyncRoute(async (req, res) => {
    const thread = await withLock('threads', async () => {
      const threads = await getThreads();
      const target = threads.find((item) => item.id === req.params.id);
      if (!target) fail(404, 'THREAD_NOT_FOUND', '对话不存在');
      if (typeof req.body?.title === 'string' && req.body.title.trim()) {
        target.title = cleanTitle(req.body.title, target.title);
      }
      if (Array.isArray(req.body?.bookIds)) target.bookIds = req.body.bookIds.slice(0, 12);
      target.updatedAt = new Date().toISOString();
      await saveThreads(threads);
      return target;
    });
    res.json(publicThread(thread));
  }),
);

app.delete(
  '/api/threads/:id',
  asyncRoute(async (req, res) => {
    await withLock('threads', async () => {
      const threads = await getThreads();
      await saveThreads(threads.filter((item) => item.id !== req.params.id));
    });
    res.json({ ok: true });
  }),
);

app.post(
  '/api/ask',
  asyncRoute(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) fail(400, 'EMPTY_QUESTION', '请输入问题');
    if (question.length > 4000) fail(400, 'QUESTION_TOO_LONG', '问题太长，请精简到 4000 字以内');
    const bookIds = Array.isArray(req.body?.bookIds) ? req.body.bookIds.slice(0, 12) : [];
    const qaMode = req.body?.qaMode === 'free' ? 'free' : 'strict';
    const scope = req.body?.scope === 'chapter' ? 'chapter' : 'book';
    const chapterIndex =
      Number.isInteger(req.body?.chapterIndex) && req.body.chapterIndex >= 0
        ? req.body.chapterIndex
        : null;
    const settings = await getSettings();
    const aiReady = resolveAi(settings).configured;
    const webSearch = Boolean(req.body?.webSearch);
    if (qaMode === 'free' && !aiReady) {
      fail(
        400,
        'AI_REQUIRED_FOR_FREE',
        '自由拓展模式需要先在「设置 → AI 服务」中配置模型。严格素材模式可继续使用本地检索。',
      );
    }
    const threads = await getThreads();
    let thread = null;
    if (req.body?.threadId) {
      thread = threads.find((item) => item.id === req.body.threadId);
    }
    if (!thread) {
      const now = new Date().toISOString();
      thread = {
        id: newId(),
        title: question.replace(/\s+/g, ' ').slice(0, 32),
        bookIds,
        qaMode,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      threads.unshift(thread);
    }
    thread.bookIds = bookIds.length ? bookIds : thread.bookIds;
    thread.qaMode = qaMode;
    if (!thread.messages.length) thread.title = question.replace(/\s+/g, ' ').slice(0, 32);

    const now = new Date().toISOString();
    thread.messages.push({
      id: newId(),
      role: 'user',
      content: question,
      sources: [],
      mode: 'user',
      qaMode,
      scope,
      chapterIndex,
      webSearch,
      createdAt: now,
    });

    const structural = /全书|整本|结构|脉络|框架|主线|跨章|章节|论证|逻辑|前后|整体/.test(question);
    const broadQuestion =
      /主要|讲了什么|讲什么|大意|主旨|概括|总结|内容|全书|这本书|文章|概述|核心|主题|中心思想/.test(
        question,
      );
    const threadBookCount = thread.bookIds?.length || 0;
    const context = await retrieveContext(question, thread.bookIds, {
      limit: structural ? 10 : broadQuestion ? 10 : threadBookCount === 1 ? 8 : 6,
      perBookLimit: structural ? 8 : broadQuestion ? 10 : threadBookCount === 1 ? 4 : 2,
      charBudget: structural ? 18000 : 13000,
      chapterIndex: scope === 'chapter' ? chapterIndex : null,
      orderByChapter: structural,
      includeAll: structural || broadQuestion,
    });
    const sources = context.sources;
    const priorMessages = thread.messages.slice(0, -1);
    const previousSearchQuery =
      [...priorMessages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.searchQuery)
        ?.searchQuery || '';
    const searchHistory = priorMessages
      .slice(-6)
      .map(
        (message) =>
          `${message.role === 'user' ? '用户' : '助手'}：${String(message.content || '').slice(0, 320)}`,
      )
      .join('\n');
    let web = { query: '', results: [], context: '', cached: false };
    let searchWarning = '';
    if (webSearch && aiReady) {
      web = await searchForQuestion(question, context.context, {
        history: searchHistory,
        previousQuery: previousSearchQuery,
      });
      if (!web.results.length) {
        searchWarning = web.error
          ? `联网搜索暂时不可用（${web.error}），已仅使用本书素材。`
          : '联网搜索没有返回有效结果，已仅使用本书素材。';
      }
    } else if (webSearch && !aiReady) {
      searchWarning = '未配置 AI，已跳过联网搜索，仅使用本书素材。';
    }
    let answer;
    let mode = 'local';
    let warning = searchWarning;
    const webBlock = web.context;

    if (aiReady) {
      try {
        const history = thread.messages
          .filter((message) => message.role === 'assistant' && !message.pending)
          .slice(-3)
          .map((message) => ({ role: 'assistant', content: message.content.slice(0, 1600) }));
        const contextBlock = context.hasMatches
          ? context.context
          : '（本次没有在所选素材中检索到直接相关内容。）';
        const strictPrompt = `你是本书精读助手，当前仅使用【本书素材】作答。
你只能基于给到的【本书素材片段】进行理解、对比、文本内逻辑推演，不得使用你预训练储存的外部解读、哲学史知识、其他文献内容来补充。
如果用户提问涉及全书结构、跨章节论证：
1. 把多条检索片段里的概念、论点、限定条件梳理出来，依照文本内部的递进关系组织；
2. 若片段之间缺少衔接段落、缺少关键论证环节，主动告知：现有检索片段有限，缺少部分原文，无法完整还原这条论证脉络；
3. 所有结论必须有原文文本支撑，素材没有明确提及的关联，不要强行建立因果；
4. 回答中标注【原文】，区分原文陈述和你基于原文做出的推导；
5. 不要编造书中不存在的论证链条。
若素材不足，直接说明“素材中没有足够信息”，不要用外部知识补足。
只使用简体中文，结构清晰，可以使用 Markdown。${webBlock ? `\n用户开启了联网搜索。你可以补充使用【联网搜索补充资料】，但必须：优先依据【本书素材】；来自书本标【原文】，来自网络标【网络来源】并附 URL；网络资料只能补充背景或框架，不能替代原文论证；若网络资料是后人对原著的解读，明确说明这是外部阐释，不等于原著本意（例如区分“海德格尔原文文本”和“二手学界解读”）；不得编造素材与搜索结果以外的信息。` : ''}`;
        const freePrompt = `你是「页间」的阅读伙伴与通用问答助手。你可以调用模型自身知识，也可以参考提供的书库素材与联网搜索结果。
优先依据【本书素材】；素材信息不足、缺少时效性或全书脉络时，才使用【联网搜索补充资料】辅助。来自书本的内容标【原文】；来自网络的内容标【网络来源】并附 URL；来自模型通用知识的内容明确写“（模型知识）”。
跨章节、全书结构类问题：优先以原文片段为根基，网络资料只用来补充逻辑框架或背景，不能替代原文论证。
若网络资料是后人对原著的解读，明确说明这是外部阐释，不等于原著本意（例如区分“海德格尔原文文本”和“二手学界解读”）。
不要编造本书的具体引文，也不要编造搜索结果中不存在的来源。
适合延伸讨论、查背景、人物时代、概念解释。使用简体中文，结构清晰，通常控制在 800 字以内，可以使用 Markdown。${webBlock ? `
若搜索结果与原文冲突，优先说明差异，不要强行合并。` : ''}`;
        const material = [`【本书素材】\n${contextBlock}`];
        if (webBlock) material.push(webBlock);
        material.push(`【用户问题】\n${question}`);
        const messages = [
          { role: 'system', content: qaMode === 'strict' ? strictPrompt : freePrompt },
          ...history,
          { role: 'user', content: material.join('\n\n') },
        ];
        const result = await callAI(messages, { maxTokens: 2200, temperature: 0.3 });
        answer = result.content;
        mode = 'ai';
      } catch (err) {
        if (qaMode === 'free') throw err;
        warning = `AI 暂时不可用，已返回本地检索结果：${err.message}`;
        answer = localAnswer(question, sources);
        mode = 'local-fallback';
      }
    } else {
      answer = localAnswer(question, sources);
      warning = warning || '尚未配置 AI，当前为本地检索答案。';
    }

    const assistant = {
      id: newId(),
      role: 'assistant',
      content: answer,
      sources: sources.map(({ text, ...source }) => source),
      webSources: web.results.map(({ title, url, snippet }) => ({ title, url, snippet })),
      searchQuery: web.query,
      webCached: web.cached,
      webSearch,
      mode,
      qaMode,
      scope,
      chapterIndex,
      createdAt: new Date().toISOString(),
    };
    thread.messages.push(assistant);
    thread.updatedAt = new Date().toISOString();
    let mergedThread = thread;
    await withLock('threads', async () => {
      const latest = await getThreads();
      const index = latest.findIndex((item) => item.id === thread.id);
      if (index < 0) {
        latest.unshift(thread);
        mergedThread = thread;
      } else {
        const target = latest[index];
        const seen = new Set((target.messages || []).map((message) => message.id));
        const appended = thread.messages.filter((message) => !seen.has(message.id));
        target.messages = [...(target.messages || []), ...appended];
        target.bookIds = thread.bookIds;
        target.qaMode = thread.qaMode;
        if (!target.title || target.title === '新对话') target.title = thread.title;
        target.updatedAt = thread.updatedAt;
        mergedThread = target;
      }
      await saveThreads(latest.slice(0, 100));
    });
    res.json({
      thread: publicThread(mergedThread),
      message: assistant,
      sources: assistant.sources,
      webSources: assistant.webSources,
      searchQuery: assistant.searchQuery,
      webCached: assistant.webCached,
      mode,
      qaMode,
      scope,
      chapterIndex,
      warning,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 概念树                                                               */
/* ------------------------------------------------------------------ */

app.get(
  '/api/concepts',
  asyncRoute(async (_req, res) => {
    const concepts = (await getConcepts()) || [];
    res.json(
      concepts
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(summarizeConcept),
    );
  }),
);

app.get(
  '/api/concepts/:id',
  asyncRoute(async (req, res) => {
    const concepts = (await getConcepts()) || [];
    const concept = concepts.find((item) => item.id === req.params.id);
    if (!concept) fail(404, 'CONCEPT_NOT_FOUND', '概念树不存在');
    res.json(concept);
  }),
);

app.post(
  '/api/concepts/generate',
  asyncRoute(async (req, res) => {
    const topic = String(req.body?.topic || '').trim();
    if (!topic) fail(400, 'TOPIC_REQUIRED', '请输入要梳理的概念或主题');
    const bookIds = Array.isArray(req.body?.bookIds) ? req.body.bookIds.slice(0, 12) : [];
    if (!bookIds.length) fail(400, 'BOOKS_REQUIRED', '请至少选择一本书');
    const books = (await getLibrary()) || [];
    const selected = books.filter((book) => bookIds.includes(book.id));
    if (!selected.length) fail(400, 'BOOKS_REQUIRED', '所选书籍不存在');
    const mode = req.body?.mode === 'local' ? 'local' : 'ai';
    let generated;
    try {
      generated = await generateConceptTree({
        topic,
        bookIds: selected.map((book) => book.id),
        mode,
      });
    } catch (err) {
      if (err.status) throw err;
      throw Object.assign(new Error(err.message || '概念树生成失败'), {
        status: 400,
        code: 'CONCEPT_FAILED',
      });
    }
    const now = new Date().toISOString();
    const concept = {
      id: newId(),
      title: generated.title || topic,
      description: generated.description || '',
      bookIds: selected.map((book) => book.id),
      bookTitles: selected.map((book) => book.title),
      root: generated.root,
      createdAt: now,
      updatedAt: now,
    };
    await withLock('concepts', async () => {
      const concepts = (await getConcepts()) || [];
      concepts.unshift(concept);
      await saveConcepts(concepts.slice(0, 200));
    });
    res.status(201).json({
      concept,
      mode: generated.mode,
      warning: generated.warning,
    });
  }),
);

app.patch(
  '/api/concepts/:id',
  asyncRoute(async (req, res) => {
    const updated = await withLock('concepts', async () => {
      const concepts = (await getConcepts()) || [];
      const concept = concepts.find((item) => item.id === req.params.id);
      if (!concept) fail(404, 'CONCEPT_NOT_FOUND', '概念树不存在');
      if (typeof req.body?.title === 'string' && req.body.title.trim()) {
        concept.title = req.body.title.trim().slice(0, 120);
      }
      if (typeof req.body?.description === 'string') {
        concept.description = req.body.description.trim().slice(0, 1000);
      }
      if (req.body?.root) concept.root = normalizeConceptRoot(req.body.root);
      if (Array.isArray(req.body?.bookIds)) {
        concept.bookIds = req.body.bookIds.slice(0, 12);
        const books = (await getLibrary()) || [];
        concept.bookTitles = books
          .filter((book) => concept.bookIds.includes(book.id))
          .map((book) => book.title);
      }
      concept.updatedAt = new Date().toISOString();
      await saveConcepts(concepts);
      return concept;
    });
    res.json(updated);
  }),
);

app.delete(
  '/api/concepts/:id',
  asyncRoute(async (req, res) => {
    await withLock('concepts', async () => {
      const concepts = (await getConcepts()) || [];
      await saveConcepts(concepts.filter((item) => item.id !== req.params.id));
    });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ */
/* 思维导图                                                             */
/* ------------------------------------------------------------------ */

app.get(
  '/api/maps',
  asyncRoute(async (req, res) => {
    const bookId = String(req.query.bookId || '');
    const maps = (await getMaps()) || [];
    const filtered = bookId ? maps.filter((map) => map.bookId === bookId) : maps;
    res.json(
      filtered
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(summarizeMap),
    );
  }),
);

app.post(
  '/api/maps',
  asyncRoute(async (req, res) => {
    const now = new Date().toISOString();
    const bookId = String(req.body?.bookId || '');
    let bookTitle = String(req.body?.bookTitle || '');
    if (bookId) {
      const books = (await getLibrary()) || [];
      bookTitle = books.find((book) => book.id === bookId)?.title || bookTitle;
    }
    const scopeType = ['book', 'chapter', 'concept'].includes(req.body?.scopeType)
      ? req.body.scopeType
      : 'book';
    const chapterIndex = Number.isInteger(req.body?.chapterIndex) ? req.body.chapterIndex : null;
    const concept = String(req.body?.concept || '').slice(0, 120);
    const map = {
      id: newId(),
      title: cleanTitle(req.body?.title || '未命名导图', '未命名导图'),
      bookId,
      bookTitle,
      theme: ['forest', 'clay', 'ocean', 'plum'].includes(req.body?.theme) ? req.body.theme : 'forest',
      scopeType,
      scopeLabel:
        String(req.body?.scopeLabel || '').slice(0, 120) ||
        (scopeType === 'concept' ? concept : scopeType === 'chapter' ? '指定章节' : '全书'),
      chapterIndex,
      concept,
      root: normalizeMapRoot(req.body?.root),
      createdAt: now,
      updatedAt: now,
    };
    await withLock('maps', async () => {
      const maps = await getMaps();
      maps.unshift(map);
      await saveMaps(maps.slice(0, 200));
    });
    res.status(201).json(map);
  }),
);

app.get(
  '/api/maps/:id',
  asyncRoute(async (req, res) => {
    const maps = await getMaps();
    const map = maps.find((item) => item.id === req.params.id);
    if (!map) fail(404, 'MAP_NOT_FOUND', '思维导图不存在');
    res.json(map);
  }),
);

app.patch(
  '/api/maps/:id',
  asyncRoute(async (req, res) => {
    const map = await withLock('maps', async () => {
      const maps = await getMaps();
      const target = maps.find((item) => item.id === req.params.id);
      if (!target) fail(404, 'MAP_NOT_FOUND', '思维导图不存在');
      if (typeof req.body?.title === 'string' && req.body.title.trim()) {
        target.title = cleanTitle(req.body.title, target.title);
      }
      if (req.body?.root) target.root = normalizeMapRoot(req.body.root);
      if (['forest', 'clay', 'ocean', 'plum'].includes(req.body?.theme)) {
        target.theme = req.body.theme;
      }
      if (typeof req.body?.bookId === 'string') target.bookId = req.body.bookId;
      if (typeof req.body?.bookTitle === 'string') target.bookTitle = req.body.bookTitle;
      if (['book', 'chapter', 'concept'].includes(req.body?.scopeType)) {
        target.scopeType = req.body.scopeType;
      }
      if (typeof req.body?.scopeLabel === 'string') {
        target.scopeLabel = req.body.scopeLabel.slice(0, 120);
      }
      if (Number.isInteger(req.body?.chapterIndex)) target.chapterIndex = req.body.chapterIndex;
      if (typeof req.body?.concept === 'string') {
        target.concept = req.body.concept.slice(0, 120);
      }
      target.updatedAt = new Date().toISOString();
      await saveMaps(maps);
      return target;
    });
    res.json(map);
  }),
);

app.delete(
  '/api/maps/:id',
  asyncRoute(async (req, res) => {
    await withLock('maps', async () => {
      const maps = await getMaps();
      await saveMaps(maps.filter((item) => item.id !== req.params.id));
    });
    res.json({ ok: true });
  }),
);

app.post(
  '/api/maps/:id/revise',
  asyncRoute(async (req, res) => {
    const instruction = String(req.body?.instruction || '').trim();
    if (!instruction) fail(400, 'INSTRUCTION_REQUIRED', '请输入修改指令');
    if (instruction.length > 1000) {
      fail(400, 'INSTRUCTION_TOO_LONG', '修改指令请控制在 1000 字以内');
    }
    const maps = (await getMaps()) || [];
    const map = maps.find((item) => item.id === req.params.id);
    if (!map) fail(404, 'MAP_NOT_FOUND', '思维导图不存在');
    const content = map.bookId ? await getBookContent(map.bookId) : null;
    const books = (await getLibrary()) || [];
    const book = books.find((item) => item.id === map.bookId) || {
      id: map.bookId,
      title: map.bookTitle,
    };
    const result = await reviseMindMap({
      map,
      instruction,
      book,
      content,
    });
    const updated = await withLock('maps', async () => {
      const latest = (await getMaps()) || [];
      const target = latest.find((item) => item.id === req.params.id);
      if (!target) fail(404, 'MAP_NOT_FOUND', '思维导图不存在');
      target.root = normalizeMapRoot(result.root);
      target.revisionCount = (target.revisionCount || 0) + 1;
      target.lastInstruction = instruction.slice(0, 300);
      target.updatedAt = new Date().toISOString();
      await saveMaps(latest);
      return target;
    });
    res.json({ map: updated, mode: result.mode });
  }),
);

app.post(
  '/api/maps/generate',
  asyncRoute(async (req, res) => {
    const bookId = String(req.body?.bookId || '');
    if (!bookId) fail(400, 'BOOK_REQUIRED', '请选择一本书');
    const { book } = await findBook(bookId);
    const content = await getBookContent(bookId);
    if (!content) fail(404, 'CONTENT_NOT_FOUND', '书籍内容文件缺失');
    const mode = req.body?.mode === 'ai' ? 'ai' : 'local';
    const scopeType = ['book', 'chapter', 'concept'].includes(req.body?.scopeType)
      ? req.body.scopeType
      : 'book';
    const concept = String(req.body?.concept || '').slice(0, 120);
    let chapterIndex = Number.isInteger(req.body?.chapterIndex) ? req.body.chapterIndex : null;
    if (scopeType === 'chapter') {
      if (
        !Number.isInteger(chapterIndex) ||
        chapterIndex < 0 ||
        chapterIndex >= content.chapters.length
      ) {
        fail(400, 'CHAPTER_REQUIRED', '请选择要生成导图的章节');
      }
    } else {
      chapterIndex = null;
    }
    if (scopeType === 'concept' && !concept.trim()) {
      fail(400, 'CONCEPT_REQUIRED', '请输入要整理的概念');
    }
    const scopeChapter = chapterIndex !== null ? content.chapters[chapterIndex] : null;
    const scopeLabel =
      scopeType === 'chapter'
        ? scopeChapter?.title || `第 ${chapterIndex + 1} 节`
        : scopeType === 'concept'
          ? concept
          : '全书';
    const customTitle = String(req.body?.title || '').trim().slice(0, 100);
    const defaultTitle =
      scopeType === 'chapter'
        ? `${scopeChapter?.title || '章节'} · 思维导图`
        : scopeType === 'concept'
          ? `${concept} · 概念图`
          : `${book.title} · 思维导图`;
    const result = await generateMindMap({
      content,
      book,
      mode,
      prompt: String(req.body?.prompt || '').slice(0, 1000),
      scopeType,
      chapterIndex,
      concept,
      title: scopeType === 'concept' ? concept : scopeChapter?.title || book.title,
    });
    const now = new Date().toISOString();
    const map = {
      id: newId(),
      title: customTitle || defaultTitle,
      bookId,
      bookTitle: book.title,
      theme: 'forest',
      scopeType,
      scopeLabel,
      chapterIndex,
      concept,
      root: normalizeMapRoot(result.root),
      createdAt: now,
      updatedAt: now,
    };
    await withLock('maps', async () => {
      const maps = await getMaps();
      maps.unshift(map);
      await saveMaps(maps.slice(0, 200));
    });
    res.status(201).json({ map, mode: result.mode, warning: result.warning });
  }),
);

/* ------------------------------------------------------------------ */
/* 静态资源                                                             */
/* ------------------------------------------------------------------ */

app.use(
  '/assets',
  express.static(ASSETS_DIR, {
    fallthrough: false,
    immutable: true,
    maxAge: '7d',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    },
  }),
);
app.use(
  '/pdfjs',
  express.static(path.join(ROOT, 'node_modules', 'pdfjs-dist'), {
    fallthrough: false,
    maxAge: '30d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }),
);

try {
  await fs.access(path.join(DIST_DIR, 'index.html'));
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} catch {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>页间</title><body style="font-family:system-ui;padding:60px;background:#f7f2e8;color:#24312b"><h1>页间 PageNest</h1><p>前端尚未构建。请运行 <code>npm run build</code> 后刷新。</p></body></html>',
      );
  });
}

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: '提交的内容过大，请精简后再试。' },
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: '请求内容不是合法的 JSON。' },
    });
  }
  const status = err.status || (err instanceof ImportError ? err.status : 500);
  const code = err.code || (err instanceof ImportError ? err.code : 'INTERNAL_ERROR');
  if (status >= 500) console.error(err);
  const exposed =
    status < 500 ||
    err instanceof ImportError ||
    err.expose === true ||
    String(code).startsWith('AI_');
  const message = exposed
    ? err.message || '请求失败'
    : '服务器处理失败，请稍后重试。';
  res.status(status).json({ error: { code, message } });
});

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  页间 PageNest');
  console.log(`  ➜  http://${HOST}:${PORT}`);
  console.log(`  ➜  数据目录 ${DATA_DIR}`);
  console.log('');
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
