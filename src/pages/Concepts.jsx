import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  GitBranch,
  LibraryBig,
  Loader2,
  Network,
  Plus,
  Quote,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { useApp } from '../context.jsx';
import {
  FORMAT_NAMES,
  cx,
  navigate,
  paletteFor,
  relativeTime,
  truncate,
} from '../utils.js';
import '../concepts/concepts.css';

const BOOK_LIMIT = 12;

async function conceptRequest(path, options = {}) {
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
  const data = type.includes('application/json')
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    const error = new Error(
      data?.error?.message || data?.message || `请求失败（HTTP ${response.status}）`,
    );
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

function bookMeta(book) {
  return [book.author, FORMAT_NAMES[book.format]].filter(Boolean).join(' · ') || '书籍';
}

function EmptyArt() {
  return (
    <div className="concept-empty-art" aria-hidden="true">
      <span className="concept-empty-orbit one" />
      <span className="concept-empty-orbit two" />
      <Network size={40} strokeWidth={1.25} />
    </div>
  );
}

export default function Concepts() {
  const { books, concepts: conceptSummaries, settings, refresh, toast } = useApp();
  const concepts = useMemo(
    () => (Array.isArray(conceptSummaries) ? conceptSummaries : []),
    [conceptSummaries],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState([]);
  const [topic, setTopic] = useState('');
  const [genMode, setGenMode] = useState('local');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const aiReady = Boolean(settings?.ai?.configured);

  const stats = useMemo(() => {
    const booksSet = new Set();
    let nodes = 0;
    let quotes = 0;
    concepts.forEach((item) => {
      (item.bookIds || []).forEach((id) => booksSet.add(id));
      nodes += Number(item.nodeCount) || 0;
      quotes += Number(item.quoteCount) || 0;
    });
    return { books: booksSet.size, nodes, quotes };
  }, [concepts]);

  useEffect(() => {
    if (!createOpen) return;
    setSelectedBookIds(books.length ? [books[0].id] : []);
    setTopic('');
    setGenMode(aiReady ? 'ai' : 'local');
    setError('');
    setBusy(false);
  }, [createOpen, books, aiReady]);

  const toggleBook = (bookId) => {
    if (busy) return;
    if (selectedBookIds.includes(bookId)) {
      setSelectedBookIds(selectedBookIds.filter((id) => id !== bookId));
      setError('');
      return;
    }
    if (selectedBookIds.length >= BOOK_LIMIT) {
      setError(`最多选择 ${BOOK_LIMIT} 本书，请先取消一本再继续。`);
      return;
    }
    setSelectedBookIds([...selectedBookIds, bookId]);
    setError('');
  };

  const selectAllBooks = () => {
    if (busy) return;
    setSelectedBookIds(books.slice(0, BOOK_LIMIT).map((book) => book.id));
    setError('');
  };

  const generate = async () => {
    const trimmed = topic.trim();
    if (!trimmed) {
      setError('先写下想梳理的概念或主题。');
      return;
    }
    if (!selectedBookIds.length) {
      setError('至少选择一本书作为材料。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const mode = genMode === 'ai' && aiReady ? 'ai' : 'local';
      const result = await conceptRequest('/api/concepts/generate', {
        method: 'POST',
        body: { topic: trimmed, bookIds: selectedBookIds, mode },
      });
      await refresh(true).catch(() => {});
      setCreateOpen(false);
      if (result?.warning) {
        toast(result.warning, 'info');
      } else {
        toast(result?.mode === 'ai' ? 'AI 已梳理概念关系' : '已从原书提取概念结构');
      }
      if (result?.concept?.id) {
        navigate(`/concepts/${result.concept.id}`);
      } else {
        toast('概念树已生成，但返回数据不完整', 'error');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeConcept = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await conceptRequest(`/api/concepts/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      });
      await refresh(true).catch(() => {});
      toast('概念树已删除');
      setDeleteTarget(null);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const selectedCount = selectedBookIds.length;

  return (
    <div className="page concepts-page">
      <header className="concepts-head">
        <div>
          <p className="eyebrow">CONCEPT TREES · 跨书概念</p>
          <h1>概念树 <em>工作台</em></h1>
          <p className="page-sub">
            跨书阅读、原书引文 + AI 梳理关系，把散落在不同书里的理解收成一棵可以继续生长的树。
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={17} /> 新建概念树
        </button>
      </header>

      <div className="concepts-stats">
        <span><Network size={15} /> {concepts.length} 棵概念树</span>
        <span><LibraryBig size={15} /> 关联 {stats.books} 本书</span>
        <span><GitBranch size={15} /> {stats.nodes} 个概念节点</span>
        <span><Quote size={15} /> {stats.quotes} 条原书引文</span>
        <span className={cx('ai-status-pill', aiReady && 'is-ready')}>
          <Sparkles size={14} /> {aiReady ? 'AI 梳理已就绪' : '本地引文提取'}
        </span>
      </div>

      {concepts.length === 0 ? (
        <div className="concepts-empty">
          <EmptyArt />
          <h2>把散落的概念种成一棵树</h2>
          <p>
            选几本书，从一个想弄懂的主题出发。系统会找出原书里的相关段落，
            再由你或 AI 把概念之间的从属、前提与回应关系接起来。
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Wand2 size={17} /> 生成第一棵概念树
          </button>
        </div>
      ) : (
        <div className="concepts-grid">
          {concepts.map((item) => {
            const bookCount = (item.bookIds || []).length || (item.bookTitles || []).length || 0;
            const bookLine = (item.bookTitles || []).slice(0, 3).join(' · ');
            return (
              <article className="concept-card" key={item.id}>
                <button
                  type="button"
                  className="concept-card-main"
                  onClick={() => navigate(`/concepts/${item.id}`)}
                >
                  <div className="concept-card-top">
                    <span className="concept-card-mark"><Network size={17} /></span>
                    <span className="concept-card-books">{bookCount} 本书</span>
                    <ArrowRight size={16} className="concept-card-arrow" />
                  </div>
                  <h3>{item.title || '未命名概念树'}</h3>
                  <p className="concept-card-desc">
                    {item.description || (bookLine ? `涉及 ${bookLine}` : '跨书概念树')}
                  </p>
                  {bookLine ? <span className="concept-card-sources">{bookLine}</span> : null}
                  <div className="concept-card-meta">
                    <span><GitBranch size={12} /> {Number(item.nodeCount) || 0} 节点</span>
                    <span><Quote size={12} /> {Number(item.quoteCount) || 0} 引文</span>
                    <span className="concept-card-time">{relativeTime(item.updatedAt)}</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="concept-card-delete"
                  title="删除概念树"
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            );
          })}
          <button type="button" className="concept-add-card" onClick={() => setCreateOpen(true)}>
            <span><Plus size={22} /></span>
            <strong>新的概念树</strong>
            <small>选书、定题、梳理关系</small>
          </button>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => { if (!busy) setCreateOpen(false); }}
        eyebrow="NEW CONCEPT TREE"
        title="新建概念树"
        width={680}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCreateOpen(false)}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={generate}
              disabled={busy || !books.length}
            >
              {busy ? (
                <><Loader2 size={16} className="spin" /> 正在梳理原文…</>
              ) : (
                <>生成概念树 <ArrowRight size={15} /></>
              )}
            </button>
          </>
        }
      >
        <div className="concepts-page create-body concept-create">
          <div className="field">
            <label htmlFor="concept-topic">想梳理的概念 / 主题</label>
            <input
              id="concept-topic"
              autoFocus
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：苦难与成长、记忆的可靠性、制度与人性"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter') generate();
              }}
            />
            <p className="field-hint">尽量用一个短词组。范围越明确，检索到的原书片段越贴近。</p>
          </div>

          <div className="field">
            <label>
              从哪些书中寻找 <span>可多选 · 最多 {BOOK_LIMIT} 本</span>
            </label>
            {books.length ? (
              <>
                <div className="concept-book-picker">
                  {books.map((book) => {
                    const checked = selectedBookIds.includes(book.id);
                    const locked = !checked && selectedCount >= BOOK_LIMIT;
                    const palette = paletteFor(book);
                    return (
                      <label
                        key={book.id}
                        className={cx(
                          'concept-book-option',
                          checked && 'is-checked',
                          locked && 'is-disabled',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBook(book.id)}
                          disabled={busy || locked}
                        />
                        <span
                          className="concept-book-tone"
                          style={{ '--tone-bg': palette.bg, '--tone-ink': palette.ink }}
                          aria-hidden="true"
                        >
                          {truncate(book.title, 1)}
                        </span>
                        <span className="concept-book-copy">
                          <strong>{book.title}</strong>
                          <small>{bookMeta(book)}{book.chapterCount ? ` · ${book.chapterCount} 节` : ''}</small>
                        </span>
                        <span className="concept-book-tick" aria-hidden="true">
                          {checked ? <Check size={13} /> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="concept-picker-tools">
                  <span>已选 {selectedCount} / {BOOK_LIMIT} 本</span>
                  <button type="button" className="text-btn" onClick={selectAllBooks} disabled={busy}>
                    全选
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setSelectedBookIds([])}
                    disabled={busy || !selectedCount}
                  >
                    清空
                  </button>
                </div>
              </>
            ) : (
              <div className="create-note">
                <BookOpen size={17} />
                <span>书架还是空的。先去导入一本书，再来梳理跨书概念。</span>
              </div>
            )}
          </div>

          <div className="field">
            <label>梳理方式</label>
            <div className="mode-cards">
              <button
                type="button"
                className={cx('mode-card', genMode === 'local' && 'is-active')}
                onClick={() => setGenMode('local')}
                disabled={busy}
              >
                <span className="mode-icon"><Network size={18} /></span>
                <span>
                  <strong>本地引文提取</strong>
                  <small>从所选书中检索相关段落，按章节组织概念，离线可用</small>
                </span>
              </button>
              <button
                type="button"
                className={cx('mode-card', genMode === 'ai' && 'is-active')}
                onClick={() => aiReady && setGenMode('ai')}
                disabled={busy || !aiReady}
                title={aiReady ? '' : '请先在设置中配置 AI'}
              >
                <span className="mode-icon"><Sparkles size={18} /></span>
                <span>
                  <strong>AI 梳理关系 {aiReady ? null : <em>未配置</em>}</strong>
                  <small>阅读原书片段，归纳概念之间的前提、从属与回应关系</small>
                </span>
              </button>
            </div>
            {!aiReady ? (
              <p className="field-hint">AI 尚未配置，当前只能使用本地引文提取；可在设置中填写 API Key 后启用。</p>
            ) : null}
          </div>

          <div className="create-note">
            <Sparkles size={17} />
            <span>
              生成后仍可增删概念、改写定义与关系；每一条引文都会保留书名、章节与页码，方便回到原文核对。
            </span>
          </div>

          {error ? <div className="form-error">{error}</div> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        eyebrow="DELETE CONCEPT TREE"
        title="删除这棵概念树？"
        width={430}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              取消
            </button>
            <button type="button" className="btn btn-danger" onClick={removeConcept} disabled={deleting}>
              {deleting ? <><Loader2 size={15} className="spin" /> 删除中…</> : <><Trash2 size={15} /> 删除</>}
            </button>
          </>
        }
      >
        <p className="modal-text">
          《{deleteTarget?.title || '未命名概念树'}》及其所有概念节点、引文会被永久删除，此操作无法撤销。
        </p>
      </Modal>
    </div>
  );
}
