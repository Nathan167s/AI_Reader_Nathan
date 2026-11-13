import * as cheerio from 'cheerio';
import { getBookContent, getLibrary } from './store.js';
import { AIError, callAI, resolveAi } from './ai.js';
import { getSettings } from './store.js';

const STOPWORDS = new Set([
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '一个', '上', '也',
  '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '这', '那', '这个', '那个',
  '什么', '如何', '怎么', '为什么', '哪些', '一下', '请', '帮我', '概括', '总结', '介绍', '主要',
  '内容', '这本书', '文中', '作者', '讲了', '讲了什么', '告诉', '可以', '能否', '根据', '关于',
  'the', 'a', 'an', 'of', 'to', 'and', 'is', 'are', 'was', 'were', 'in', 'on', 'for', 'with',
  'what', 'how', 'why', 'this', 'that', 'it', 'be', 'as', 'at', 'by', 'from',
]);

export function normalizeQuery(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function tokenize(value = '') {
  const text = String(value).toLowerCase();
  const tokens = new Set();
  const latin = text.match(/[a-z0-9][a-z0-9'’-]{1,}/g) || [];
  latin.forEach((word) => {
    if (!STOPWORDS.has(word)) tokens.add(word);
  });
  const cjkRuns = text.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const run of cjkRuns) {
    if (run.length <= 8 && !STOPWORDS.has(run)) tokens.add(run);
    for (let i = 0; i < run.length - 1; i += 1) {
      const gram = run.slice(i, i + 2);
      if (!STOPWORDS.has(gram)) tokens.add(gram);
    }
    if (run.length >= 3) {
      for (let i = 0; i < run.length - 2; i += 1) {
        const gram = run.slice(i, i + 3);
        if (!STOPWORDS.has(gram)) tokens.add(gram);
      }
    }
  }
  return [...tokens].slice(0, 28);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
    if (count > 50) break;
  }
  return count;
}

export function splitIntoChunks(text, maxLength = 950, overlap = 100) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];
  if (source.length <= maxLength) return [source];
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + maxLength);
    if (end < source.length) {
      const window = source.slice(Math.max(start + Math.floor(maxLength * 0.55), start), end);
      const breakpoints = ['\n\n', '\n', '。', '！', '？', '；', '. ', '! ', '? ', '; '];
      let cut = -1;
      for (const mark of breakpoints) {
        const idx = window.lastIndexOf(mark);
        if (idx > cut) cut = idx + mark.length;
      }
      if (cut > 0) end = Math.max(start + Math.floor(maxLength * 0.55), start + Math.floor(maxLength * 0.55) + cut);
      end = Math.min(end, source.length);
    }
    const piece = source.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function buildBookChunks(content, book) {
  const chunks = [];
  (content.chapters || []).forEach((chapter, chapterIndex) => {
    const parts = splitIntoChunks(chapter.text || '', 900, 90);
    parts.forEach((text, partIndex) => {
      chunks.push({
        id: `${book.id}:${chapterIndex}:${partIndex}`,
        bookId: book.id,
        bookTitle: book.title,
        format: book.format,
        chapterIndex,
        chapterTitle: chapter.title,
        page: content.format === 'pdf' ? chapterIndex + 1 : null,
        text,
        title: chapter.title,
      });
    });
  });
  return chunks;
}

export function scoreChunk(chunk, query, tokens) {
  const haystack = `${chunk.chapterTitle}\n${chunk.text}`.toLowerCase();
  const plain = chunk.text.toLowerCase();
  const queryLower = query.toLowerCase();
  let score = 0;
  if (queryLower) score += countOccurrences(plain, queryLower) * 14;
  for (const token of tokens) {
    score += countOccurrences(plain, token) * (token.length > 2 ? 3 : 2);
    if (chunk.chapterTitle.toLowerCase().includes(token)) score += 3;
  }
  if (score > 0) score += Math.min(5, 300 / Math.max(120, plain.length));
  return score;
}

export function makeSnippet(text, query, tokens, length = 210) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const lower = source.toLowerCase();
  let index = query ? lower.indexOf(query.toLowerCase()) : -1;
  if (index < 0) {
    for (const token of tokens) {
      const found = lower.indexOf(token);
      if (found >= 0) {
        index = found;
        break;
      }
    }
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - Math.floor(length * 0.3));
  const end = Math.min(source.length, start + length);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

export async function searchBook(bookId, query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return { hits: [], query: normalized };
  const books = (await getLibrary()) || [];
  const book = books.find((item) => item.id === bookId);
  if (!book) return { hits: [], query: normalized };
  const content = await getBookContent(bookId);
  if (!content) return { hits: [], query: normalized };
  const tokens = tokenize(normalized);
  const chunks = buildBookChunks(content, book);
  const hits = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, normalized, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map(({ chunk, score }) => ({
      bookId: book.id,
      bookTitle: book.title,
      chapterIndex: chunk.chapterIndex,
      chapterTitle: chunk.chapterTitle,
      page: chunk.page,
      snippet: makeSnippet(chunk.text, normalized, tokens),
      score,
    }));
  const deduped = [];
  const seen = new Set();
  for (const hit of hits) {
    const key = `${hit.chapterIndex}:${hit.snippet.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(hit);
    if (deduped.length >= 12) break;
  }
  return { hits: deduped, query: normalized };
}

export async function searchLibrary(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return { books: [], hits: [], query: normalized };
  const books = (await getLibrary()) || [];
  const tokens = tokenize(normalized);
  const lower = normalized.toLowerCase();
  const bookMatches = books
    .filter((book) => {
      const haystack = `${book.title} ${book.author} ${book.excerpt}`.toLowerCase();
      return haystack.includes(lower) || tokens.some((token) => haystack.includes(token));
    })
    .slice(0, 8)
    .map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      excerpt: book.excerpt,
    }));

  const allHits = [];
  for (const book of books.slice(0, 30)) {
    const content = await getBookContent(book.id);
    if (!content) continue;
    const chunks = buildBookChunks(content, book);
    const matched = chunks
      .map((chunk) => ({ chunk, score: scoreChunk(chunk, normalized, tokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const { chunk, score } of matched) {
      allHits.push({
        bookId: book.id,
        bookTitle: book.title,
        format: book.format,
        chapterIndex: chunk.chapterIndex,
        chapterTitle: chunk.chapterTitle,
        page: chunk.page,
        snippet: makeSnippet(chunk.text, normalized, tokens),
        score,
      });
    }
  }
  allHits.sort((a, b) => b.score - a.score);
  return {
    books: bookMatches,
    hits: allHits.slice(0, 16),
    query: normalized,
  };
}

/* ------------------------------------------------------------------ */
/* 问答                                                                 */
/* ------------------------------------------------------------------ */

function sourceLine(source, index) {
  const location = source.page
    ? `第 ${source.page} 页`
    : source.chapterTitle || `第 ${source.chapterIndex + 1} 节`;
  return `[${index + 1}] 《${source.bookTitle}》 · ${location}\n${source.text}`;
}

export async function retrieveContext(question, bookIds = [], options = {}) {
  const library = (await getLibrary()) || [];
  let selected = bookIds?.length
    ? library.filter((book) => bookIds.includes(book.id))
    : [...library].sort(
        (a, b) => new Date(b.lastOpenedAt || b.createdAt) - new Date(a.lastOpenedAt || a.createdAt),
      ).slice(0, 6);
  if (selected.length > 8) selected = selected.slice(0, 8);
  const query = normalizeQuery(question);
  const tokens = tokenize(query);
  const candidates = [];
  for (const book of selected) {
    const content = await getBookContent(book.id);
    if (!content) continue;
    const chunks = buildBookChunks(content, book);
    for (const chunk of chunks) {
      if (Number.isInteger(options.chapterIndex) && chunk.chapterIndex !== options.chapterIndex) {
        continue;
      }
      const score = scoreChunk(chunk, query, tokens);
      if (score > 0) {
        candidates.push({ chunk, score });
      } else if (Number.isInteger(options.chapterIndex) || options.includeAll) {
        // 章节范围问答或全书结构类问题，应把范围内的原文都作为素材。
        candidates.push({ chunk, score: 0.5 });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const chosen = [];
  const perBook = new Map();
  for (const item of candidates) {
    const count = perBook.get(item.chunk.bookId) || 0;
    if (count >= (options.perBookLimit ?? 2)) continue;
    if (chosen.some((c) => c.text === item.chunk.text)) continue;
    chosen.push(item);
    perBook.set(item.chunk.bookId, count + 1);
    if (chosen.length >= (options.limit ?? 6)) break;
  }
  if (options.orderByChapter) {
    chosen.sort(
      (a, b) =>
        String(a.chunk.bookId).localeCompare(String(b.chunk.bookId)) ||
        a.chunk.chapterIndex - b.chunk.chapterIndex,
    );
  }

  let budget = options.charBudget ?? 13000;
  const sources = [];
  const contextParts = [];
  for (const { chunk } of chosen) {
    if (budget <= 0) break;
    const text = chunk.text.slice(0, Math.min(1800, budget));
    budget -= text.length;
    sources.push({
      bookId: chunk.bookId,
      bookTitle: chunk.bookTitle,
      chapterIndex: chunk.chapterIndex,
      chapterTitle: chunk.chapterTitle,
      page: chunk.page,
      snippet: makeSnippet(chunk.text, query, tokens, 260),
      text,
    });
    contextParts.push(sourceLine({ ...chunk, text }, sources.length - 1));
  }
  return {
    sources,
    context: contextParts.join('\n\n'),
    selectedBooks: selected.map((book) => ({ id: book.id, title: book.title })),
    hasMatches: sources.length > 0,
  };
}

export function localAnswer(question, sources) {
  if (!sources.length) {
    return `我在所选书籍中没有找到与「${question}」直接相关的内容。\n\n可以试试换一个更具体的关键词，或在右上角扩大问答范围。接入 AI 后，即使原文没有直接命中，也可以进行归纳和推理。`;
  }
  const points = [];
  for (const source of sources.slice(0, 5)) {
    const text = source.text.replace(/\s+/g, ' ').trim();
    const sentences = text
      .split(/(?<=[。！？!?；;])/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 12);
    const query = question.replace(/\s+/g, '');
    const best =
      sentences.find((sentence) => sentence.includes(query)) ||
      sentences.slice(0, 2).join('') ||
      text.slice(0, 120);
    points.push(
      `- **《${source.bookTitle}》${source.page ? ` · 第 ${source.page} 页` : source.chapterTitle ? ` · ${source.chapterTitle}` : ''}**\n  ${best.slice(0, 160)}`,
    );
  }
  return `根据书库中的原文，与「${question}」相关的线索有：\n\n${points.join('\n')}\n\n> 当前是本地检索模式，以上是原文摘录。到「设置 → AI 服务」接入模型后，我可以把这些内容综合成完整回答。`;
}

/* ------------------------------------------------------------------ */
/* 思维导图                                                             */
/* ------------------------------------------------------------------ */

function cleanNodeText(value, limit = 34) {
  let text = String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[#>*_`~\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：·•\-—]+|[\s:：·•\-—]+$/g, '')
    .trim();
  if (text.length > limit) text = `${text.slice(0, limit)}…`;
  return text;
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\n+/g, '。')
    .split(/(?<=[。！？!?；;])/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 12 && sentence.length <= 160);
}

function frequencyMap(text) {
  const map = new Map();
  const cjk = text.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i += 1) {
      const gram = run.slice(i, i + 2);
      if (STOPWORDS.has(gram)) continue;
      map.set(gram, (map.get(gram) || 0) + 1);
    }
  }
  const latin = text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  latin.forEach((word) => {
    if (!STOPWORDS.has(word)) map.set(word, (map.get(word) || 0) + 1);
  });
  return map;
}

function topSentences(text, count = 4) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];
  const freq = frequencyMap(text);
  const scored = sentences.map((sentence, index) => {
    let score = 0;
    for (let i = 0; i < sentence.length - 1; i += 1) {
      const gram = sentence.slice(i, i + 2);
      if (/[\u3400-\u9fff]{2}/.test(gram)) score += freq.get(gram) || 0;
    }
    score = score / Math.sqrt(sentence.length + 20);
    if (index < 3) score += 1.5;
    if (index === 0) score += 1;
    if (/[0-9]/.test(sentence)) score += 0.4;
    return { sentence, score, index };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const item of scored) {
    if (picked.some((p) => p.sentence.slice(0, 16) === item.sentence.slice(0, 16))) continue;
    picked.push(item);
    if (picked.length >= count) break;
  }
  return picked.sort((a, b) => a.index - b.index).map((item) => item.sentence);
}

function keywordsOf(text, count = 3) {
  const freq = frequencyMap(text);
  return [...freq.entries()]
    .filter(([word]) => word.length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}

function outlineFromChapter(chapter, content) {
  const children = [];
  if (chapter.html) {
    const $ = cheerio.load(`<body>${chapter.html}</body>`);
    const headings = $('h2,h3,h4')
      .toArray()
      .map((el) => ({
        level: Number((el.tagName || 'h2').slice(1)),
        text: cleanNodeText($(el).text(), 30),
      }))
      .filter((heading) => heading.text.length >= 2);
    if (headings.length >= 2) {
      const stack = [];
      const root = { children };
      for (const heading of headings) {
        const node = { text: heading.text, children: [] };
        while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
        if (!stack.length) children.push(node);
        else stack[stack.length - 1].node.children.push(node);
        stack.push({ level: heading.level, node });
      }
      return children.slice(0, 6);
    }
  }
  const sentences = topSentences(chapter.text, 3);
  for (const sentence of sentences) {
    const text = cleanNodeText(sentence, 30);
    if (!text) continue;
    children.push({ text, children: [] });
  }
  if (!children.length && chapter.title) {
    children.push({ text: cleanNodeText(chapter.title, 30), children: [] });
  }
  return children.slice(0, 4);
}

function normalizeAiTree(raw, fallbackTitle) {
  const seen = new Set();
  let count = 0;
  function walk(node, depth) {
    if (!node || count >= 70 || depth > 4) return null;
    const text = cleanNodeText(node.text || node.title || node.name || '', depth === 0 ? 46 : 30);
    if (!text || seen.has(text)) return null;
    seen.add(text);
    count += 1;
    const children = Array.isArray(node.children)
      ? node.children
          .map((child) => walk(child, depth + 1))
          .filter(Boolean)
          .slice(0, 6)
      : [];
    return { text, children };
  }
  return walk(raw, 0) || { text: fallbackTitle, children: [] };
}

function parseAiJson(text) {
  const cleaned = String(text)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('AI 没有返回有效的 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function localMindMap(content, book, rootTitleOverride = '') {
  const chapters = content.chapters || [];
  const rootTitle = cleanNodeText(
    rootTitleOverride || book?.title || content.title || '阅读笔记',
    46,
  );
  const children = [];

  const isPagedPdf = content.format === 'pdf';
  if (!isPagedPdf && chapters.length >= 2 && chapters.length <= 9) {
    for (const chapter of chapters) {
      const title = cleanNodeText(chapter.title, 30);
      if (!title || /^第 \d+ (页|节)$/.test(title) && chapters.length > 4) continue;
      children.push({
        text: title,
        children: outlineFromChapter(chapter, content),
      });
    }
  }

  if (!children.length) {
    const allText = chapters.map((chapter) => chapter.text).join('\n\n');
    const headings = [];
    if (chapters.length === 1 && chapters[0].html) {
      const $ = cheerio.load(`<body>${chapters[0].html}</body>`);
      $('h2,h3').each((_, el) => {
        const text = cleanNodeText($(el).text(), 30);
        if (text.length >= 2) headings.push(text);
      });
    }
    if (headings.length >= 3) {
      headings.slice(0, 7).forEach((heading) => {
        children.push({ text: heading, children: [] });
      });
    } else {
      const sentences = topSentences(allText, 6);
      sentences.forEach((sentence) => {
        const text = cleanNodeText(sentence, 32);
        if (!text) return;
        children.push({ text, children: [] });
      });
      if (!children.length) {
        chapters.slice(0, 5).forEach((chapter) => {
          children.push({ text: cleanNodeText(chapter.title, 30), children: [] });
        });
      }
    }
  }

  const tree = { text: rootTitle, children: children.slice(0, 7) };
  if (!tree.children.length) tree.children.push({ text: '开始阅读，记录第一个想法', children: [] });
  return tree;
}

export async function generateMindMap({
  content,
  book,
  mode = 'local',
  prompt = '',
  scopeType = 'book',
  chapterIndex = null,
  concept = '',
  title = '',
}) {
  const settings = await getSettings();
  const aiReady = resolveAi(settings).configured;
  const allChapters = content.chapters || [];
  const focusIndex =
    Number.isInteger(chapterIndex) && chapterIndex >= 0 && chapterIndex < allChapters.length
      ? chapterIndex
      : null;
  const chapters =
    focusIndex !== null ? [allChapters[focusIndex]] : allChapters;
  const scopedContent = { ...content, chapters };
  const rootTitle = cleanNodeText(
    title ||
      (scopeType === 'concept' && concept
        ? concept
        : focusIndex !== null
          ? allChapters[focusIndex]?.title
          : book.title),
    46,
  );

  if (mode === 'ai' && aiReady) {
    try {
      const allText = chapters
        .slice(0, 12)
        .map((chapter) => `【${chapter.title}】\n${chapter.text}`)
        .join('\n\n')
        .slice(0, 15000);
      const scopeHint =
        scopeType === 'chapter' && focusIndex !== null
          ? `本图只聚焦第 ${focusIndex + 1} 节《${allChapters[focusIndex]?.title || ''}》，不要扩展到其他章节。`
          : scopeType === 'concept'
            ? `本图围绕概念「${concept}」组织，从素材中提取与它相关的定义、表现、例子和边界。`
            : '本图覆盖整本书的主干结构。';
      const messages = [
        {
          role: 'system',
          content:
            '你是结构化的阅读助手。你要把文章整理成清晰的思维导图，只输出 JSON，不要输出 Markdown 或解释。',
        },
        {
          role: 'user',
          content: `请为下面这段阅读材料生成一份思维导图。\n\n书名：${book.title}\n${scopeHint}\n${prompt ? `额外要求：${prompt}\n` : ''}\n根节点使用：${rootTitle}\n输出格式：\n{"title":"根节点","children":[{"text":"一级分支","children":[{"text":"二级分支","children":[]}]}]}\n\n要求：\n1. 3-6 个一级分支，节点总数不超过 45 个；\n2. 每个节点 4-22 个汉字，尽量使用原文概念；\n3. 结构体现“主题—观点—细节”的层次；\n4. 只使用 JSON，不要代码块。\n\n文章：\n${allText}`,
        },
      ];
      const result = await callAI(messages, { temperature: 0.3, maxTokens: 1800, timeout: 90000 });
      const parsed = parseAiJson(result.content);
      const tree = normalizeAiTree(parsed, rootTitle);
      return { root: tree, mode: 'ai', warning: '' };
    } catch (err) {
      return {
        root: localMindMap(scopedContent, book, rootTitle),
        mode: 'local',
        warning: `AI 生成未成功，已使用本地结构提取：${err.message}`,
      };
    }
  }
  return {
    root: localMindMap(scopedContent, book, rootTitle),
    mode: 'local',
    warning: mode === 'ai' && !aiReady ? '尚未配置 AI，已使用本地结构提取。' : '',
  };
}

export async function reviseMindMap({ map, instruction, book, content }) {
  const settings = await getSettings();
  if (!resolveAi(settings).configured) {
    throw new Error('请先在设置中配置 AI，才能用指令修改导图。');
  }
  const current = {
    title: map.root?.text || map.title,
    children: (map.root?.children || []).map(function shape(node) {
      return {
        text: node.text,
        children: (node.children || []).map(shape),
      };
    }),
  };
  const sourceText = (content?.chapters || [])
    .slice(0, 8)
    .map((chapter) => `【${chapter.title}】\n${chapter.text}`)
    .join('\n\n')
    .slice(0, 9000);
  const messages = [
    {
      role: 'system',
      content:
        '你是思维导图编辑助手。根据用户的修改指令，返回修改后的完整思维导图 JSON。只输出 JSON，不要解释，不要输出 Markdown 代码块。',
    },
    {
      role: 'user',
      content: `当前思维导图：\n${JSON.stringify(current)}\n\n修改指令：${instruction}\n\n${sourceText ? `可参考的原文：\n${sourceText}\n\n` : ''}要求：\n1. 保留未被指令要求改变的结构和节点，不要无故重写全图；\n2. 节点总数不超过 60 个，每个节点 4-24 个汉字；\n3. 只输出同样格式的 JSON：{"title":"根节点","children":[...]}；\n4. 不要编造原文没有的具体事实，除非指令明确要求补充通用背景。`,
    },
  ];
  const result = await callAI(messages, {
    temperature: 0.25,
    maxTokens: 4000,
    timeout: 120000,
  });
  let parsed;
  try {
    parsed = parseAiJson(result.content);
  } catch {
    throw new AIError(
      'AI 没有返回可用的导图 JSON，请换一种说法再试一次。',
      'AI_INVALID_MAP',
      502,
    );
  }
  const root = normalizeAiTree(parsed, map.root?.text || map.title || book?.title || '思维导图');
  return { root, mode: 'ai' };
}
