import crypto from 'node:crypto';
import { AIError, callAI, resolveAi } from './ai.js';
import { getNotesData, getSettings } from './store.js';

function clean(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function noteSummary(note) {
  return {
    id: note.id,
    bookId: note.bookId,
    bookTitle: note.bookTitle,
    chapterIndex: note.chapterIndex,
    chapterTitle: note.chapterTitle,
    page: note.page,
    quote: note.quote,
    title: note.title,
    content: note.content,
    category: note.category || '未分类',
    tags: note.tags || [],
    aiTitle: note.aiTitle || '',
    aiSummary: note.aiSummary || '',
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function createNote(input, book) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    bookId: book.id,
    bookTitle: book.title,
    chapterIndex: Number.isInteger(input.chapterIndex) ? input.chapterIndex : null,
    chapterTitle: clean(input.chapterTitle, 120),
    page: Number.isInteger(input.page) ? input.page : null,
    quote: clean(input.quote, 4000),
    title: clean(input.title, 160),
    content: clean(input.content, 8000),
    category: clean(input.category, 40) || '未分类',
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => clean(tag, 20)).slice(0, 8) : [],
    aiTitle: '',
    aiSummary: '',
    createdAt: now,
    updatedAt: now,
  };
}

function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('AI 没有返回有效 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function organizeBookNotes(bookId, bookTitle) {
  const settings = await getSettings();
  if (!resolveAi(settings).configured) {
    throw new AIError('AI 分类笔记需要先在设置中配置模型。', 'AI_NOT_CONFIGURED', 400);
  }
  const data = await getNotesData();
  const notes = data.items.filter((note) => note.bookId === bookId).slice(0, 120);
  if (!notes.length) {
    throw new AIError('这本书还没有笔记，先记录几条再让 AI 整理。', 'NO_NOTES', 400);
  }
  const payload = notes.map((note) => ({
    id: note.id,
    quote: note.quote?.slice(0, 600) || '',
    content: note.content?.slice(0, 1200) || '',
    chapter: note.chapterTitle || '',
    category: note.category || '未分类',
  }));
  const messages = [
    {
      role: 'system',
      content:
        '你是学术阅读笔记整理助手。只输出 JSON，不要输出 Markdown。要把同一本书的零散笔记按主题分类、起标题、写摘要，不得编造笔记和原文中不存在的内容。',
    },
    {
      role: 'user',
      content: `书名：《${bookTitle}》\n请整理下面的读书笔记。\n输出格式：\n{"overview":"全书笔记的整理概览，2-3句","categories":[{"name":"分类名","summary":"该分类的简要说明","notes":[{"id":"原笔记id","title":"精简标题","summary":"这条笔记的凝练摘要"}]}]}\n要求：\n1. 分类 3-6 个，名称使用学术化中文；\n2. 每条笔记必须保留原 id，不能遗漏；\n3. 标题不超过 24 字，摘要不超过 90 字；\n4. 只巩固和归类已有信息，不要新增原文没有的观点。\n\n笔记：\n${JSON.stringify(payload)}`,
    },
  ];
  const result = await callAI(messages, {
    temperature: 0.2,
    maxTokens: 3000,
    timeout: 120000,
  });
  let parsed;
  try {
    parsed = extractJson(result.content);
  } catch {
    throw new AIError('AI 返回的笔记分类格式不可用，请重试。', 'AI_INVALID_NOTES', 502);
  }
  const byId = new Map(notes.map((note) => [note.id, note]));
  const categories = [];
  const now = new Date().toISOString();
  for (const category of Array.isArray(parsed.categories) ? parsed.categories.slice(0, 8) : []) {
    const name = clean(category.name, 40) || '未分类';
    categories.push({ name, summary: clean(category.summary, 300) });
    for (const item of Array.isArray(category.notes) ? category.notes : []) {
      const note = byId.get(String(item.id || ''));
      if (!note) continue;
      note.category = name;
      note.aiTitle = clean(item.title, 80);
      note.aiSummary = clean(item.summary, 300);
      note.updatedAt = now;
    }
  }
  const overview = clean(parsed.overview, 1000);
  data.analyses[bookId] = { overview, categories, updatedAt: now };
  return { data, analysis: data.analyses[bookId], categories };
}

export function groupNotesForExport(notes, analysis) {
  const categories = analysis?.categories || [];
  return {
    overview: analysis?.overview || '',
    categories,
    notes: notes.map((note) => ({
      ...note,
      category: note.category || '未分类',
    })),
  };
}
