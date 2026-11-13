import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Download,
  GitBranch,
  Loader2,
  Plus,
  Quote,
  Save,
  Trash2,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { useApp } from '../context.jsx';
import {
  cx,
  downloadText,
  navigate,
  safeFilename,
  truncate,
} from '../utils.js';
import {
  collectIds,
  countNodes,
  countQuotes,
  ensureNodeIds,
  findNode,
  findPath,
  insertChild,
  makeConceptNode,
  removeNode,
  sanitizeRoot,
  uniqueConceptName,
  updateNode,
} from '../concepts/tree.js';
import '../concepts/concepts.css';

const AUTOSAVE_MS = 800;

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

function ConceptTreeNode({
  node,
  depth,
  selectedId,
  expanded,
  onSelect,
  onToggle,
  onAddChild,
  onDelete,
}) {
  const children = node.children || [];
  const hasChildren = children.length > 0;
  const open = expanded.has(node.id);
  return (
    <div className="concept-tree-branch">
      <div
        className={cx(
          'concept-tree-row',
          depth === 0 && 'is-root',
          node.id === selectedId && 'is-selected',
        )}
        style={{ '--depth': depth }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="concept-tree-toggle"
            onClick={() => onToggle(node.id)}
            title={open ? '收起这个节点' : '展开这个节点'}
            aria-label={open ? '收起这个节点' : '展开这个节点'}
          >
            <ChevronRight
              size={13}
              className={cx('concept-tree-chevron', open && 'is-open')}
            />
          </button>
        ) : (
          <span className="concept-tree-spacer" />
        )}
        <button
          type="button"
          className="concept-tree-label"
          onClick={() => onSelect(node.id)}
          title={node.concept || '未命名概念'}
        >
          <span className="concept-tree-name">{node.concept || '未命名概念'}</span>
          {node.quotes?.length ? (
            <span className="concept-tree-quote-count">
              <Quote size={9} /> {node.quotes.length}
            </span>
          ) : null}
        </button>
        <div className="concept-tree-actions">
          <button
            type="button"
            title="添加子概念"
            onClick={(event) => {
              event.stopPropagation();
              onAddChild(node.id);
            }}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            title={depth === 0 ? '根概念不能删除' : '删除这个节点'}
            disabled={depth === 0}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(node.id);
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {hasChildren && open ? (
        <div className="concept-tree-children">
          {children.map((child) => (
            <ConceptTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuoteCard({ quote, canOpen, onOpen }) {
  const chapter =
    quote.chapterTitle ||
    (Number.isInteger(quote.chapterIndex) ? `第 ${quote.chapterIndex + 1} 章` : '');
  const source = [chapter, quote.page ? `第 ${quote.page} 页` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <blockquote className="concept-quote">
      <p className="concept-quote-text">{quote.text || '（这条引文没有正文）'}</p>
      <footer className="concept-quote-meta">
        <span className="concept-quote-book">
          <BookOpen size={11} /> {quote.bookTitle || '未知书籍'}
        </span>
        {source ? <span>{source}</span> : null}
        {canOpen ? (
          <button type="button" className="text-link" onClick={onOpen}>
            在书中查看 <ArrowUpRight size={11} />
          </button>
        ) : null}
      </footer>
    </blockquote>
  );
}

export default function ConceptEditor({ conceptId }) {
  const { books, toast, refresh, openBook } = useApp();
  const [concept, setConcept] = useState(null);
  const [root, setRoot] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bookIds, setBookIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rootRef = useRef(null);
  const titleRef = useRef('');
  const descriptionRef = useRef('');
  const bookIdsRef = useRef([]);
  const dirtyRef = useRef(false);
  const versionRef = useRef(0);
  const conceptIdRef = useRef(conceptId);

  rootRef.current = root;
  titleRef.current = title;
  descriptionRef.current = description;
  bookIdsRef.current = bookIds;
  conceptIdRef.current = conceptId;

  const selectedNode = useMemo(
    () => (root ? findNode(root, selectedId) || root : null),
    [root, selectedId],
  );
  const path = useMemo(
    () => (root ? findPath(root, selectedNode?.id) : null),
    [root, selectedNode?.id],
  );
  const parentNode = path && path.length > 1 ? path[path.length - 2] : null;
  const nodeCount = useMemo(() => countNodes(root), [root]);
  const quoteCount = useMemo(() => countQuotes(root), [root]);

  const bookTitles = useMemo(() => {
    const saved = concept?.bookTitles || [];
    if (saved.length) return saved;
    const byId = new Map(books.map((book) => [book.id, book.title]));
    return bookIds.map((id) => byId.get(id)).filter(Boolean);
  }, [concept?.bookTitles, bookIds, books]);

  const availableBookIds = useMemo(
    () => new Set(books.map((book) => book.id)),
    [books],
  );

  useEffect(() => {
    if (!conceptId) {
      setError('缺少概念树 ID');
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError('');
    setDirty(false);
    dirtyRef.current = false;
    versionRef.current = 0;
    conceptRequest(`/api/concepts/${encodeURIComponent(conceptId)}`)
      .then((data) => {
        if (!alive) return;
        const nextRoot = ensureNodeIds(data.root);
        if (!nextRoot) {
          setError('这棵概念树还没有内容');
          setLoading(false);
          return;
        }
        setConcept(data);
        setRoot(nextRoot);
        rootRef.current = nextRoot;
        setTitle(data.title || '');
        titleRef.current = data.title || '';
        setDescription(data.description || '');
        descriptionRef.current = data.description || '';
        setBookIds(data.bookIds || []);
        bookIdsRef.current = data.bookIds || [];
        setSelectedId(nextRoot.id);
        setExpanded(new Set(collectIds(nextRoot)));
        setSaveState('saved');
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [conceptId]);

  useEffect(() => {
    if (!root) return;
    if (!selectedId || !findNode(root, selectedId)) {
      setSelectedId(root.id);
    }
  }, [root, selectedId]);

  const markDirty = useCallback(() => {
    versionRef.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaveState('saving');
  }, []);

  const commit = useCallback(
    (nextRoot) => {
      if (!nextRoot || !rootRef.current) return;
      if (nextRoot === rootRef.current) return;
      rootRef.current = nextRoot;
      setRoot(nextRoot);
      markDirty();
    },
    [markDirty],
  );

  const saveNow = useCallback(async () => {
    const id = conceptIdRef.current;
    if (!id || !rootRef.current) return;
    const version = versionRef.current;
    setSaveState('saving');
    try {
      const saved = await conceptRequest(`/api/concepts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: {
          title: titleRef.current.trim() || '未命名概念树',
          description: descriptionRef.current,
          root: sanitizeRoot(rootRef.current),
          bookIds: bookIdsRef.current,
        },
      });
      setConcept((current) => (current ? { ...current, ...saved } : saved));
      if (version === versionRef.current) {
        dirtyRef.current = false;
        setDirty(false);
        setSaveState('saved');
      }
    } catch (err) {
      setSaveState('error');
      toast(`保存失败：${err.message}`, 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (!dirty || loading || !concept) return undefined;
    const timer = setTimeout(() => {
      saveNow();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, root, title, description, bookIds, concept, loading, saveNow]);

  useEffect(() => {
    const id = conceptId;
    return () => {
      if (!id || !dirtyRef.current || !rootRef.current) return;
      try {
        fetch(`/api/concepts/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titleRef.current.trim() || '未命名概念树',
            description: descriptionRef.current,
            root: sanitizeRoot(rootRef.current),
            bookIds: bookIdsRef.current,
          }),
          keepalive: true,
        });
      } catch {
        // 尽力保存
      }
    };
  }, [conceptId]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  const changeTitle = (value) => {
    setTitle(value);
    titleRef.current = value;
    markDirty();
  };

  const commitTitle = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle('未命名概念树');
      titleRef.current = '未命名概念树';
      markDirty();
      return;
    }
    if (trimmed !== title) {
      setTitle(trimmed);
      titleRef.current = trimmed;
      markDirty();
    }
  };

  const patchSelected = useCallback(
    (patch) => {
      if (!rootRef.current || !selectedNode) return;
      commit(updateNode(rootRef.current, selectedNode.id, patch));
    },
    [selectedNode, commit],
  );

  const trimSelectedField = (field, fallback = '') => {
    if (!rootRef.current || !selectedNode) return;
    const raw = String(selectedNode[field] || '');
    const value = raw.trim();
    if (!value && fallback) {
      commit(updateNode(rootRef.current, selectedNode.id, { [field]: fallback }));
      return;
    }
    if (value !== raw) {
      commit(updateNode(rootRef.current, selectedNode.id, { [field]: value }));
    }
  };

  const toggleNode = useCallback((id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addChild = useCallback(
    (parentId) => {
      if (!rootRef.current) return;
      const parent = findNode(rootRef.current, parentId) || findNode(rootRef.current, selectedId) || rootRef.current;
      const child = makeConceptNode(uniqueConceptName(rootRef.current, '新概念'));
      const next = insertChild(rootRef.current, parent.id, child);
      if (next === rootRef.current) return;
      commit(next);
      setExpanded((current) => {
        const nextSet = new Set(current);
        nextSet.add(parent.id);
        return nextSet;
      });
      setSelectedId(child.id);
      window.setTimeout(() => {
        document.querySelector('.concept-detail-name')?.focus();
      }, 60);
    },
    [selectedId, commit],
  );

  const deleteNode = useCallback(
    (nodeId) => {
      if (!rootRef.current || !nodeId) return;
      if (nodeId === rootRef.current.id) {
        toast('根概念不能删除');
        return;
      }
      const target = findNode(rootRef.current, nodeId);
      const trail = findPath(rootRef.current, nodeId);
      const parent = trail && trail.length > 1 ? trail[trail.length - 2] : null;
      const result = removeNode(rootRef.current, nodeId);
      if (!result.removed) return;
      const childCount = target ? countNodes(target) - 1 : 0;
      commit(result.root);
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
      setSelectedId(parent?.id || rootRef.current.id);
      toast(
        childCount > 0
          ? `已删除「${truncate(target?.concept || '节点', 16)}」及其 ${childCount} 个子概念`
          : `已删除「${truncate(target?.concept || '节点', 18)}」`,
      );
    },
    [commit, toast],
  );

  const exportMarkdown = () => {
    if (!rootRef.current) return;
    const lines = [`# ${title.trim() || '未命名概念树'}`];
    if (description.trim()) lines.push('', `> ${description.trim()}`);
    const walk = (node, level) => {
      const heading = '#'.repeat(Math.min(6, level));
      lines.push('', `${heading} ${node.concept || '未命名概念'}`);
      if (node.relation) lines.push('', `*与父概念的关系：${node.relation}*`);
      if (node.definition) lines.push('', node.definition);
      (node.quotes || []).forEach((quote) => {
        const source = [
          `《${quote.bookTitle || '未知书籍'}》`,
          quote.chapterTitle,
          quote.page ? `第 ${quote.page} 页` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        lines.push('', `> ${quote.text}`, `> — ${source}`);
      });
      (node.children || []).forEach((child) => walk(child, level + 1));
    };
    walk(rootRef.current, 2);
    downloadText(
      lines.join('\n'),
      `${safeFilename(title || '概念树')}.md`,
      'text/markdown;charset=utf-8',
    );
    toast('Markdown 已导出');
  };

  const goBack = async () => {
    if (dirtyRef.current) await saveNow();
    navigate('/concepts');
  };

  const deleteConcept = async () => {
    if (!concept?.id) return;
    setDeleting(true);
    try {
      await conceptRequest(`/api/concepts/${encodeURIComponent(concept.id)}`, {
        method: 'DELETE',
      });
      dirtyRef.current = false;
      await refresh(true).catch(() => {});
      toast('概念树已删除');
      navigate('/concepts');
    } catch (err) {
      toast(err.message, 'error');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="reader-fatal">
        <span className="reader-loader"><Loader2 size={22} className="spin" /></span>
        <p>正在展开概念树…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="reader-fatal">
        <h2>没能打开这棵概念树</h2>
        <p>{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/concepts')}>
          返回概念树列表
        </button>
      </div>
    );
  }

  if (!root || !selectedNode) return null;

  return (
    <div className="concept-editor">
      <header className="concept-topbar">
        <div className="concept-top-left">
          <button
            type="button"
            className="icon-btn"
            onClick={goBack}
            title="返回概念树列表"
            aria-label="返回概念树列表"
          >
            <ArrowLeft size={19} />
          </button>
          <div className="concept-title-wrap">
            <input
              className="concept-title-input"
              value={title}
              onChange={(event) => changeTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              aria-label="概念树标题"
              placeholder="未命名概念树"
            />
            <span className="concept-subtitle">
              <span><BookOpen size={11} /> 跨 {bookTitles.length || bookIds.length} 本书</span>
              <i />
              <span><GitBranch size={11} /> {nodeCount} 个概念</span>
              <i />
              <span><Quote size={11} /> {quoteCount} 条引文</span>
              {bookTitles.length ? (
                <>
                  <i />
                  <span className="concept-subtitle-books">
                    {truncate(bookTitles.join('、'), 34)}
                  </span>
                </>
              ) : null}
            </span>
          </div>
        </div>
        <div className="concept-top-actions">
          <span className={cx('save-state', saveState === 'error' && 'is-error')}>
            {saveState === 'saving' ? (
              <Loader2 size={12} className="spin" />
            ) : saveState === 'saved' ? (
              <Check size={12} />
            ) : (
              <Save size={12} />
            )}
            {saveState === 'saving'
              ? '保存中…'
              : saveState === 'saved'
                ? '已保存'
                : saveState === 'error'
                  ? '保存失败'
                  : '未保存'}
          </span>
          <div className="concept-top-divider" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportMarkdown}
            title="导出 Markdown"
          >
            <Download size={15} /> <span>导出</span>
          </button>
          <button
            type="button"
            className="icon-btn danger-hover"
            onClick={() => setDeleteOpen(true)}
            title="删除概念树"
            aria-label="删除概念树"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="concept-body">
        <aside className="concept-tree-panel">
          <header className="concept-tree-head">
            <div>
              <p className="eyebrow">STRUCTURE</p>
              <h2>概念结构</h2>
            </div>
            <span className="concept-tree-total">{nodeCount} 个节点</span>
          </header>
          <div className="concept-tree-scroll">
            <ConceptTreeNode
              node={root}
              depth={0}
              selectedId={selectedNode.id}
              expanded={expanded}
              onSelect={setSelectedId}
              onToggle={toggleNode}
              onAddChild={addChild}
              onDelete={deleteNode}
            />
          </div>
          <footer className="concept-tree-foot">
            <span>选中节点后，在右侧编辑</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => addChild(selectedNode.id)}
            >
              <Plus size={13} /> 子概念
            </button>
          </footer>
        </aside>

        <section className="concept-detail">
          <div className="concept-detail-inner">
            <header className="concept-detail-head">
              <div className="concept-detail-heading">
                <p className="eyebrow">
                  {selectedNode.id === root.id ? 'ROOT CONCEPT' : 'CONCEPT NODE'}
                </p>
                <h2>{selectedNode.concept || '未命名概念'}</h2>
                <div className="concept-detail-path">
                  {(path || []).map((item, index) => (
                    <span key={item.id}>
                      {index ? <ChevronRight size={10} /> : null}
                      <button
                        type="button"
                        className={cx(
                          'concept-path-btn',
                          item.id === selectedNode.id && 'is-current',
                        )}
                        onClick={() => setSelectedId(item.id)}
                      >
                        {truncate(item.concept || '未命名概念', 16)}
                      </button>
                    </span>
                  ))}
                </div>
                {selectedNode.id === root.id && description ? (
                  <p className="concept-detail-summary">{description}</p>
                ) : null}
              </div>
              <div className="concept-detail-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => addChild(selectedNode.id)}
                >
                  <Plus size={14} /> 子概念
                </button>
                <button
                  type="button"
                  className="icon-btn danger-hover"
                  onClick={() => deleteNode(selectedNode.id)}
                  disabled={selectedNode.id === root.id}
                  title={selectedNode.id === root.id ? '根概念不能删除' : '删除当前概念'}
                  aria-label="删除当前概念"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </header>

            <div className="concept-detail-fields">
              <div className="field">
                <label htmlFor="concept-node-name">概念名</label>
                <input
                  id="concept-node-name"
                  className="concept-detail-name"
                  value={selectedNode.concept || ''}
                  onChange={(event) => patchSelected({ concept: event.target.value })}
                  onBlur={() =>
                    trimSelectedField(
                      'concept',
                      selectedNode.id === rootRef.current?.id ? '未命名概念树' : '未命名概念',
                    )
                  }
                  placeholder="用一个短词组命名"
                />
              </div>
              <div className="field">
                <label htmlFor="concept-node-relation">
                  与父概念的关系
                  <span>
                    {parentNode
                      ? `父概念 · ${parentNode.concept || '未命名概念'}`
                      : '根概念没有父节点'}
                  </span>
                </label>
                <input
                  id="concept-node-relation"
                  value={selectedNode.relation || ''}
                  onChange={(event) => patchSelected({ relation: event.target.value })}
                  onBlur={() => trimSelectedField('relation')}
                  disabled={!parentNode}
                  placeholder={
                    parentNode
                      ? '例如：构成前提 / 用于回应 / 与……相对'
                      : '根概念没有父概念'
                  }
                />
              </div>
            </div>

            <div className="field concept-definition-field">
              <label htmlFor="concept-node-definition">
                定义 <span>它在原书语境中的具体含义</span>
              </label>
              <textarea
                id="concept-node-definition"
                rows={5}
                value={selectedNode.definition || ''}
                onChange={(event) => patchSelected({ definition: event.target.value })}
                onBlur={() => trimSelectedField('definition')}
                placeholder="贴着原书说清楚这个概念指什么，必要时写下它与相邻概念的差别。"
              />
            </div>

            <section className="concept-quotes">
              <header className="concept-quotes-head">
                <h3>原书引文</h3>
                <span>{selectedNode.quotes?.length || 0} 条</span>
                <em>只读 · 来自原书</em>
              </header>
              {selectedNode.quotes?.length ? (
                <div className="concept-quote-list">
                  {selectedNode.quotes.map((quote, index) => (
                    <QuoteCard
                      key={`${quote.bookId || 'quote'}-${index}`}
                      quote={quote}
                      canOpen={Boolean(quote.bookId && availableBookIds.has(quote.bookId))}
                      onOpen={() =>
                        openBook?.(quote.bookId, {
                          chapter: quote.chapterIndex ?? undefined,
                          page: quote.page ?? undefined,
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="concept-quotes-empty">
                  <Quote size={18} strokeWidth={1.4} />
                  <span>这个节点还没有绑定原书引文</span>
                  <small>引文由生成时从所选书籍中检索，编辑时保持只读。</small>
                </div>
              )}
            </section>
          </div>
        </section>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => { if (!deleting) setDeleteOpen(false); }}
        eyebrow="DELETE CONCEPT TREE"
        title="删除这棵概念树？"
        width={430}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              取消
            </button>
            <button type="button" className="btn btn-danger" onClick={deleteConcept} disabled={deleting}>
              {deleting ? <><Loader2 size={15} className="spin" /> 删除中…</> : <><Trash2 size={15} /> 删除概念树</>}
            </button>
          </>
        }
      >
        <p className="modal-text">
          《{title || '未命名概念树'}》及其所有概念节点、引文会被永久删除，此操作无法撤销。
        </p>
      </Modal>
    </div>
  );
}
