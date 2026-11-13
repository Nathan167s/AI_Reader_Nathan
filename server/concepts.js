import crypto from 'node:crypto';
import { callAI, resolveAi } from './ai.js';
import { getSettings, getLibrary, getBookContent } from './store.js';
import { retrieveContext } from './retrieval.js';

function clean(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseJson(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('AI 没有返回有效 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function quoteFromSource(source) {
  if (!source) return null;
  return {
    bookId: source.bookId,
    bookTitle: source.bookTitle,
    chapterIndex: source.chapterIndex,
    chapterTitle: source.chapterTitle,
    page: source.page || null,
    text: clean(source.text || source.snippet, 600),
  };
}

function normalizeNode(raw, sources, depth = 0, used = new Set()) {
  if (!raw || depth > 5) return null;
  let concept = clean(raw.concept || raw.text || raw.name, 80);
  if (!concept) return null;
  if (used.has(concept)) return null;
  used.add(concept);
  const refs = Array.isArray(raw.refs) ? raw.refs : Array.isArray(raw.quoteRefs) ? raw.quoteRefs : [];
  const quotes = refs
    .map((ref) => quoteFromSource(sources[Number(ref) - 1]))
    .filter(Boolean);
  if (!quotes.length && Array.isArray(raw.quotes)) {
    raw.quotes.slice(0, 3).forEach((quote) => {
      if (quote?.text) {
        quotes.push({
          bookId: quote.bookId || '',
          bookTitle: quote.bookTitle || '',
          chapterIndex: quote.chapterIndex ?? null,
          chapterTitle: quote.chapterTitle || '',
          page: quote.page || null,
          text: clean(quote.text, 600),
        });
      }
    });
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : crypto.randomUUID().slice(0, 10),
    concept,
    definition: clean(raw.definition || raw.summary, 1200),
    relation: clean(raw.relation || raw.relationLabel, 200),
    quotes: quotes.slice(0, 3),
    children: Array.isArray(raw.children)
      ? raw.children
          .slice(0, 8)
          .map((child) => normalizeNode(child, sources, depth + 1, used))
          .filter(Boolean)
      : [],
  };
}

function localTree(topic, sources) {
  const root = {
    id: crypto.randomUUID().slice(0, 10),
    concept: topic,
    definition: sources[0]?.snippet || '从选定书籍中提取的概念关系。',
    relation: '',
    quotes: sources.slice(0, 2).map(quoteFromSource).filter(Boolean),
    children: [],
  };
  for (const source of sources.slice(0, 6)) {
    const concept = clean(source.chapterTitle || source.snippet.slice(0, 28), 60);
    if (!concept || root.children.some((child) => child.concept === concept)) continue;
    root.children.push({
      id: crypto.randomUUID().slice(0, 10),
      concept,
      definition: clean(source.snippet, 500),
      relation: '相关章节',
      quotes: [quoteFromSource(source)].filter(Boolean),
      children: [],
    });
  }
  return root;
}

export async function generateConceptTree({ topic, bookIds = [], mode = 'ai' }) {
  const cleanTopic = clean(topic, 120);
  if (!cleanTopic) throw new Error('请输入要梳理的概念或主题');
  const settings = await getSettings();
  const aiReady = resolveAi(settings).configured;
  const context = await retrieveContext(cleanTopic, bookIds, {
    limit: 10,
    perBookLimit: 4,
    charBudget: 16000,
    orderByChapter: true,
  });
  if (!context.sources.length) {
    throw new Error('没有在所选的书中检索到与该概念相关的原文，请换一个关键词或扩大书籍范围。');
  }
  let warning = '';
  if (mode === 'ai' && aiReady) {
    try {
      const messages = [
        {
          role: 'system',
          content:
            '你是学术概念树整理助手。你只能基于提供的原书片段建立概念关系，不能编造原文，也不能把模型记忆伪装成原书引文。只输出 JSON。',
        },
        {
          role: 'user',
          content: `请围绕「${cleanTopic}」生成一棵跨书概念树。\n\n概念树 JSON 格式：\n{"title":"${cleanTopic}","description":"整体说明","root":{"concept":"${cleanTopic}","definition":"基于原文的界定","relation":"","refs":[1,2],"children":[{"concept":"子概念","definition":"...","relation":"与父概念的关系","refs":[3],"children":[]}]}}\n\n要求：\n1. 根节点 + 3-7 个一级概念，最多 25 个节点；\n2. refs 必须引用下方原文编号 [1]、[2]…，每个节点至少 1 条原文引文；\n3. 概念名称 2-12 字，definition 说明它在本材料中的含义；\n4. relation 说明与父概念的关系（如“构成前提”“用于回应”“与……相对”）；\n5. 区分“原文明确说”与“你基于原文的归纳”，归纳不要写成原文引语；\n6. 只输出 JSON，不要 Markdown。\n\n原书片段：\n${context.context}`,
        },
      ];
      const result = await callAI(messages, {
        temperature: 0.25,
        maxTokens: 3200,
        timeout: 120000,
      });
      const parsed = parseJson(result.content);
      const root = normalizeNode(parsed.root || parsed, context.sources);
      if (!root) throw new Error('AI 返回的概念树为空');
      return {
        title: clean(parsed.title || cleanTopic, 120),
        description: clean(parsed.description, 1000),
        root,
        mode: 'ai',
        warning: '',
      };
    } catch (err) {
      warning = `AI 概念树生成未成功，已使用本地概念提取：${err.message}`;
    }
  }
  return {
    title: cleanTopic,
    description: '由原书片段与章节主题自动提取的概念框架，可在编辑器中继续补充关系。',
    root: localTree(cleanTopic, context.sources),
    mode: 'local',
    warning: warning || (mode === 'ai' && !aiReady ? '尚未配置 AI，已使用本地提取。' : ''),
  };
}

export function summarizeConcept(tree) {
  const count = (node) => 1 + (node.children || []).reduce((sum, child) => sum + count(child), 0);
  return {
    id: tree.id,
    title: tree.title,
    description: tree.description,
    bookIds: tree.bookIds || [],
    bookTitles: tree.bookTitles || [],
    createdAt: tree.createdAt,
    updatedAt: tree.updatedAt,
    nodeCount: count(tree.root || {}),
    quoteCount: (() => {
      let total = 0;
      const walk = (node) => {
        total += node.quotes?.length || 0;
        (node.children || []).forEach(walk);
      };
      walk(tree.root || {});
      return total;
    })(),
  };
}

export function normalizeConceptRoot(root) {
  return normalizeNode(root, [], 0, new Set()) || {
    id: crypto.randomUUID().slice(0, 10),
    concept: '新概念',
    definition: '',
    relation: '',
    quotes: [],
    children: [],
  };
}
