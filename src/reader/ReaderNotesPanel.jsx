import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
  Quote,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import { cx, navigate, relativeTime, truncate } from '../utils.js';
import './ReaderNotesPanel.css';

const HEADER_COLLAPSE_KEY = 'pagenest.reader.notesHeaderCollapsed';

function readHeaderCollapsed() {
  try {
    return window.localStorage.getItem(HEADER_COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/* api.js 还没有笔记方法：组件内自带一个最小 request，方法补齐后自动复用。 */

async function request(path, options = {}) {
  const { body, headers, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const type = response.headers.get('content-type') || '';
  let data = null;
  if (type.includes('application/json')) {
    data = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const message =
      data?.error?.message || data?.message || `请求失败（HTTP ${response.status}）`;
    const error = new Error(message);
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

// 若之后在 api.js 新增同名方法，请保持 (bookId, payload) / (id, payload) 的参数顺序。
const notesApi = {
  list: (bookId) =>
    typeof api.getNotes === 'function'
      ? api.getNotes(bookId)
      : request(`/api/books/${bookId}/notes`),
  create: (bookId, payload) =>
    typeof api.createNote === 'function'
      ? api.createNote(bookId, payload)
      : request(`/api/books/${bookId}/notes`, { method: 'POST', body: payload }),
  update: (noteId, payload) =>
    typeof api.updateNote === 'function'
      ? api.updateNote(noteId, payload)
      : request(`/api/notes/${noteId}`, { method: 'PATCH', body: payload }),
  remove: (noteId) =>
    typeof api.deleteNote === 'function'
      ? api.deleteNote(noteId)
      : request(`/api/notes/${noteId}`, { method: 'DELETE' }),
  organize: (bookId) =>
    typeof api.organizeNotes === 'function'
      ? api.organizeNotes(bookId)
      : request(`/api/books/${bookId}/notes/organize`, { method: 'POST' }),
};

function timeOf(note) {
  const value = Date.parse(note?.updatedAt || note?.createdAt || '');
  return Number.isNaN(value) ? 0 : value;
}

function noteSource(note) {
  const chapter = String(note?.chapterTitle || '').trim();
  const chapterText =
    chapter ||
    (Number.isInteger(note?.chapterIndex) ? `第 ${note.chapterIndex + 1} 节` : '');
  const pageText = Number.isInteger(note?.page) ? `第 ${note.page} 页` : '';
  if (!chapterText) return pageText;
  if (pageText && !chapterText.includes(pageText)) return `${chapterText} · ${pageText}`;
  return chapterText;
}

function deriveTitle(quote, content) {
  const text = String(quote || content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export default function ReaderNotesPanel({
  book,
  chapterIndex,
  chapterTitle,
  page,
  quoteRequest,
  onPromptConsumed,
}) {
  const { settings, toast } = useApp();
  const aiReady = Boolean(settings?.ai?.configured);
  const bookId = book?.id || '';

  const [notes, setNotes] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');

  const [composerOpen, setComposerOpen] = useState(true);
  const [headerCollapsed, setHeaderCollapsed] = useState(readHeaderCollapsed);
  const [quote, setQuote] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ quote: '', content: '', category: '' });
  const [busyId, setBusyId] = useState(null);

  const quoteRef = useRef(null);
  const contentRef = useRef(null);
  const scrollRef = useRef(null);
  const loadTokenRef = useRef(0);
  const consumedRef = useRef(onPromptConsumed);
  const uid = useId();
  const categoryListId = `${uid}-note-categories`;

  useEffect(() => {
    consumedRef.current = onPromptConsumed;
  }, [onPromptConsumed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HEADER_COLLAPSE_KEY, headerCollapsed ? '1' : '0');
    } catch {
      // localStorage may be unavailable in private or restricted contexts.
    }
  }, [headerCollapsed]);

  const load = useCallback(async () => {
    if (!bookId) return;
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    try {
      const data = await notesApi.list(bookId);
      if (token !== loadTokenRef.current) return;
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
      setAnalysis(data?.analysis || null);
      setFailed(false);
      setError('');
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      setFailed(true);
      setError(err.message);
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    setNotes([]);
    setAnalysis(null);
    setEditingId(null);
    setError('');
    setFailed(false);
    if (!bookId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [bookId, load]);

  // 右键「记笔记」/选中文字后：自动填入引文并聚焦
  useEffect(() => {
    const text = quoteRequest?.text;
    if (!text) return undefined;
    setComposerOpen(true);
    setQuote(text);
    setError('');
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    const timer = setTimeout(() => {
      const element = quoteRef.current;
      element?.focus();
      element?.setSelectionRange?.(text.length, text.length);
    }, 80);
    consumedRef.current?.();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteRequest?.nonce]);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => timeOf(b) - timeOf(a)),
    [notes],
  );

  const groups = useMemo(() => {
    const order = (analysis?.categories || [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean);
    const summaries = new Map(
      (analysis?.categories || []).map((item) => [
        String(item?.name || '').trim(),
        String(item?.summary || '').trim(),
      ]),
    );
    const buckets = new Map();
    for (const note of sortedNotes) {
      const name = String(note.category || '').trim() || '未分类';
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(note);
    }
    const names = [...buckets.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? order.length + 1 : ia) - (ib === -1 ? order.length + 1 : ib);
      }
      if (a === '未分类') return 1;
      if (b === '未分类') return -1;
      return a.localeCompare(b, 'zh-Hans-CN');
    });
    return names.map((name) => ({
      name,
      summary: summaries.get(name) || '',
      notes: buckets.get(name),
    }));
  }, [analysis, sortedNotes]);

  const categoryOptions = useMemo(() => {
    const names = new Set();
    for (const item of analysis?.categories || []) {
      const name = String(item?.name || '').trim();
      if (name) names.add(name);
    }
    for (const note of notes) {
      const name = String(note.category || '').trim();
      if (name && name !== '未分类') names.add(name);
    }
    return [...names].slice(0, 12);
  }, [analysis, notes]);

  const currentSource = useMemo(() => {
    const chapter = String(chapterTitle || '').trim();
    const chapterText =
      chapter || (Number.isInteger(chapterIndex) ? `第 ${chapterIndex + 1} 节` : '当前位置');
    if (Number.isInteger(page) && !chapterText.includes(`第 ${page} 页`)) {
      return `${chapterText} · 第 ${page} 页`;
    }
    return chapterText;
  }, [chapterIndex, chapterTitle, page]);

  const subtitle = notes.length
    ? `${groups.length} 个分类 · ${truncate(book?.title || '', 18)}`
    : `摘录与想法 · ${truncate(book?.title || '这本书', 18)}`;

  const canSave = Boolean(quote.trim() || content.trim());
  const exportUrl = bookId ? `/api/books/${encodeURIComponent(bookId)}/notes.docx` : '#';

  const save = async () => {
    if (saving || !bookId) return;
    const quoteText = quote.trim();
    const contentText = content.trim();
    if (!quoteText && !contentText) {
      setError('写一点评论，或先摘录一段原文。');
      quoteRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await notesApi.create(bookId, {
        quote: quoteText,
        title: deriveTitle(quoteText, contentText),
        content: contentText,
        category: category.trim(),
        chapterIndex: Number.isInteger(chapterIndex) ? chapterIndex : null,
        chapterTitle: typeof chapterTitle === 'string' ? chapterTitle.slice(0, 120) : '',
        page: Number.isInteger(page) ? page : null,
      });
      if (result?.note) setNotes((current) => [result.note, ...current]);
      setQuote('');
      setContent('');
      setCategory('');
      toast('已保存这条笔记');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const organize = async () => {
    if (organizing || !bookId) return;
    if (!aiReady) {
      setError('AI 整理需要先在设置中配置模型。');
      return;
    }
    if (!notes.length) {
      setError('这本书还没有笔记，先记几条再让 AI 整理。');
      return;
    }
    setOrganizing(true);
    setError('');
    try {
      const result = await notesApi.organize(bookId);
      if (Array.isArray(result?.notes)) {
        setNotes(result.notes);
        setAnalysis(result.analysis || null);
      } else {
        await load();
      }
      toast('AI 已分类整理');
    } catch (err) {
      setError(err.message);
    } finally {
      setOrganizing(false);
    }
  };

  const beginEdit = (note) => {
    setEditingId(note.id);
    setError('');
    setDraft({
      quote: note.quote || '',
      content: note.content || '',
      category: note.category === '未分类' ? '' : note.category || '',
    });
  };

  const saveEdit = async (note) => {
    if (busyId) return;
    const quoteText = draft.quote.trim();
    const contentText = draft.content.trim();
    if (!quoteText && !contentText) {
      setError('笔记不能为空：留一句摘录或一段评论。');
      return;
    }
    setBusyId(note.id);
    setError('');
    try {
      const result = await notesApi.update(note.id, {
        title: note.title || '',
        quote: quoteText,
        content: contentText,
        category: draft.category.trim(),
      });
      if (result?.note) {
        setNotes((current) =>
          current.map((item) => (item.id === note.id ? result.note : item)),
        );
      }
      setEditingId(null);
      toast('笔记已更新');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (note) => {
    if (busyId) return;
    if (!window.confirm('删除这条笔记？删除后无法恢复。')) return;
    setBusyId(note.id);
    setError('');
    try {
      await notesApi.remove(note.id);
      setNotes((current) => current.filter((item) => item.id !== note.id));
      if (editingId === note.id) setEditingId(null);
      toast('笔记已删除');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleExport = (event) => {
    if (!notes.length || !bookId) {
      event.preventDefault();
      toast('还没有笔记可以导出', 'info');
    }
  };

  const handleComposerKey = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  };

  const focusComposer = () => {
    setComposerOpen(true);
    setTimeout(() => {
      (quote.trim() ? contentRef : quoteRef).current?.focus();
    }, 60);
  };

  return (
    <div className="notes-panel">
      <header className={cx('notes-panel-top', headerCollapsed && 'is-collapsed')}>
        <div className="notes-panel-head-row">
          <div className="notes-panel-title">
            <p className="eyebrow">READING NOTES</p>
            <h3>
              读书笔记
              <span>{notes.length}</span>
            </h3>
            <p className="notes-panel-sub">{subtitle}</p>
          </div>

          <button
            type="button"
            className="notes-panel-header-toggle"
            onClick={() => setHeaderCollapsed((value) => !value)}
            aria-expanded={!headerCollapsed}
            title={headerCollapsed ? '展开读书笔记头部' : '收起读书笔记头部'}
          >
            {headerCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>

        {!headerCollapsed ? (
          <>
            <div className="notes-panel-tools">
              <button
                type="button"
                className="notes-panel-tool is-ai"
                onClick={organize}
                disabled={organizing || !notes.length}
                title={aiReady ? '让 AI 按主题归并、起标题并写摘要' : '需要先在设置中配置 AI'}
              >
                {organizing ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
                {organizing ? '正在整理…' : 'AI 整理'}
              </button>
              <a
                className={cx('notes-panel-tool', !notes.length && 'is-disabled')}
                href={exportUrl}
                onClick={handleExport}
                aria-disabled={!notes.length}
                title="导出为 Word 文档"
              >
                <Download size={12} /> 导出 Word
              </a>
            </div>

            {!aiReady ? (
              <button
                type="button"
                className="notes-panel-aihint"
                onClick={() => navigate('/settings')}
              >
                <Settings size={12} />
                <span>AI 未配置，配置后才能自动分类整理</span>
                <ArrowRight size={11} />
              </button>
            ) : null}
          </>
        ) : null}
      </header>

      <div className="notes-panel-scroll" ref={scrollRef}>
        {error ? (
          <div className="notes-panel-error" role="alert">
            <span>{error}</span>
            {/AI|配置/.test(error) ? (
              <button type="button" onClick={() => navigate('/settings')}>
                去设置
              </button>
            ) : failed ? (
              <button
                type="button"
                onClick={() => {
                  setFailed(false);
                  setLoading(true);
                  load();
                }}
              >
                重试
              </button>
            ) : null}
            <button
              type="button"
              className="notes-panel-error-close"
              onClick={() => setError('')}
              aria-label="关闭提示"
            >
              <X size={11} />
            </button>
          </div>
        ) : null}

        <section className={cx('notes-panel-composer', !composerOpen && 'is-collapsed')}>
          <button
            type="button"
            className="notes-panel-composer-toggle"
            onClick={() => setComposerOpen((value) => !value)}
            aria-expanded={composerOpen}
          >
            <span>
              <Quote size={12} /> 记一条笔记
            </span>
            <ChevronDown
              size={14}
              className={cx('notes-panel-chevron', composerOpen && 'is-open')}
            />
          </button>

          {composerOpen ? (
            <div className="notes-panel-form">
              <label className="notes-panel-field">
                <span>引文 / 摘录</span>
                <textarea
                  ref={quoteRef}
                  value={quote}
                  rows={2}
                  maxLength={4000}
                  placeholder="在书里选中文字后会自动填入，也可以手动粘贴一句原文"
                  onChange={(event) => setQuote(event.target.value)}
                  onKeyDown={handleComposerKey}
                />
              </label>
              <label className="notes-panel-field">
                <span>我的评论</span>
                <textarea
                  ref={contentRef}
                  value={content}
                  rows={2}
                  maxLength={8000}
                  placeholder="这段文字让你想到什么？"
                  onChange={(event) => setContent(event.target.value)}
                  onKeyDown={handleComposerKey}
                />
              </label>
              <div className="notes-panel-form-row">
                <input
                  className="notes-panel-cat"
                  list={categoryListId}
                  value={category}
                  maxLength={40}
                  placeholder="分类（留空为未分类）"
                  aria-label="分类"
                  onChange={(event) => setCategory(event.target.value)}
                />
                <button
                  type="button"
                  className="notes-panel-save"
                  onClick={save}
                  disabled={!canSave || saving}
                >
                  {saving ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                  {saving ? '保存中' : '保存'}
                </button>
              </div>
              <p className="notes-panel-source">
                <BookOpen size={11} /> 记录到 {currentSource}
              </p>
            </div>
          ) : null}
        </section>

        {analysis?.overview ? (
          <div className="notes-panel-analysis">
            <span className="notes-panel-analysis-head">
              <Sparkles size={11} /> AI 整理概览
            </span>
            <p>{analysis.overview}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="notes-panel-loading">
            <Loader2 size={18} className="spin" />
            <span>正在翻开笔记本…</span>
          </div>
        ) : notes.length === 0 ? (
          <div className="notes-panel-empty">
            <span className="notes-panel-empty-orb">
              <NotebookPen size={20} />
            </span>
            <h3>还没有笔记</h3>
            <p>选中书里的句子并选择「记笔记」，摘录会自动填进来；也可以直接写下自己的想法。</p>
            <button type="button" className="notes-panel-cta" onClick={focusComposer}>
              <Plus size={12} /> 写第一条
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <section className="notes-panel-group" key={group.name}>
              <header className="notes-panel-group-head">
                <span className="notes-panel-group-name" title={group.name}>
                  {group.name}
                </span>
                <span className="notes-panel-group-count">{group.notes.length}</span>
              </header>
              {group.summary ? (
                <p className="notes-panel-group-summary">{group.summary}</p>
              ) : null}

              <div className="notes-panel-list">
                {group.notes.map((note) => {
                  const isEditing = editingId === note.id;
                  const busy = busyId === note.id;
                  const heading = String(note.aiTitle || note.title || '').trim();
                  const quoteText = String(note.quote || '').trim();
                  const contentText = String(note.content || '').trim();
                  const bareHeading = heading.replace(/…$/, '');
                  const duplicated = quoteText
                    ? quoteText.startsWith(bareHeading)
                    : contentText.startsWith(bareHeading);
                  const showHeading = Boolean(bareHeading) && !duplicated;
                  const source = noteSource(note);

                  return (
                    <article
                      className={cx('notes-panel-note', isEditing && 'is-editing')}
                      key={note.id}
                    >
                      <header className="notes-panel-note-top">
                        <span className="notes-panel-chip" title={note.category || '未分类'}>
                          {note.category || '未分类'}
                        </span>
                        <span className="notes-panel-note-time">
                          {relativeTime(note.updatedAt || note.createdAt)}
                        </span>
                      </header>

                      {isEditing ? (
                        <div className="notes-panel-edit">
                          <label className="notes-panel-field">
                            <span>引文 / 摘录</span>
                            <textarea
                              rows={2}
                              maxLength={4000}
                              value={draft.quote}
                              onChange={(event) =>
                                setDraft((current) => ({ ...current, quote: event.target.value }))
                              }
                            />
                          </label>
                          <label className="notes-panel-field">
                            <span>我的评论</span>
                            <textarea
                              rows={3}
                              maxLength={8000}
                              value={draft.content}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  content: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <input
                            className="notes-panel-cat"
                            list={categoryListId}
                            value={draft.category}
                            maxLength={40}
                            placeholder="分类（留空为未分类）"
                            aria-label="分类"
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                category: event.target.value,
                              }))
                            }
                          />
                          <div className="notes-panel-edit-actions">
                            <button
                              type="button"
                              className="notes-panel-save"
                              onClick={() => saveEdit(note)}
                              disabled={busy}
                            >
                              {busy ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                              保存
                            </button>
                            <button
                              type="button"
                              className="notes-panel-cancel"
                              onClick={() => setEditingId(null)}
                              disabled={busy}
                            >
                              <X size={12} /> 取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {showHeading ? (
                            <h4 className="notes-panel-note-title">{heading}</h4>
                          ) : null}
                          {quoteText ? (
                            <blockquote className="notes-panel-note-quote">
                              {quoteText}
                            </blockquote>
                          ) : null}
                          {contentText ? (
                            <p className="notes-panel-note-body">{contentText}</p>
                          ) : null}
                          {note.aiSummary ? (
                            <p className="notes-panel-note-ai">
                              <Sparkles size={11} />
                              <span>{note.aiSummary}</span>
                            </p>
                          ) : null}

                          <footer className="notes-panel-note-foot">
                            <span
                              className="notes-panel-note-source"
                              title={source || '未记录出处'}
                            >
                              <BookOpen size={10} />
                              {source || '未记录出处'}
                            </span>
                            <span className="notes-panel-note-actions">
                              <button
                                type="button"
                                onClick={() => beginEdit(note)}
                                disabled={busy}
                              >
                                <Pencil size={11} /> 编辑
                              </button>
                              <button
                                type="button"
                                className="is-danger"
                                onClick={() => remove(note)}
                                disabled={busy}
                              >
                                <Trash2 size={11} /> 删除
                              </button>
                            </span>
                          </footer>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <datalist id={categoryListId}>
        {categoryOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
