import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  FileText,
  LibraryBig,
  MessageCircleQuestion,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TreePine,
  X,
} from 'lucide-react';
import BookCover from '../components/BookCover.jsx';
import Modal from '../components/Modal.jsx';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import {
  FORMAT_LABELS,
  FORMAT_NAMES,
  cx,
  formatDate,
  formatNumber,
  navigate,
  progressPercent,
  relativeTime,
  truncate,
} from '../utils.js';

const FILTERS = ['全部', '文本', 'PDF', 'Word', '网页', 'EPUB'];

function matchesFilter(book, filter) {
  if (filter === '全部') return true;
  if (filter === '文本') return ['txt', 'md'].includes(book.format);
  if (filter === 'PDF') return book.format === 'pdf';
  if (filter === 'Word') return ['docx', 'doc'].includes(book.format);
  if (filter === '网页') return ['web', 'html'].includes(book.format);
  if (filter === 'EPUB') return book.format === 'epub';
  return true;
}

function HighlightedText({ text, query }) {
  if (!query?.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text).split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? <mark key={index}>{part}</mark> : part,
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export default function Library() {
  const { books, maps, threads, concepts, stats, route, refresh, setImportOpen, openBook, toast } = useApp();
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState(() => route.query.get('q') || '');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    if (route.query.get('q')) setQuery(route.query.get('q'));
  }, [route.query]);

  useEffect(() => {
    if (route.query.get('focus') === 'search' || window.location.hash.includes('focus=search')) {
      setTimeout(() => searchRef.current?.focus(), 200);
    }
  }, [route.query]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setSearching(false);
      return undefined;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchAll(query.trim());
        if (alive) setResults(data);
      } catch (err) {
        if (alive) toast(err.message, 'error');
      } finally {
        if (alive) setSearching(false);
      }
    }, 320);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, toast]);

  useEffect(() => {
    if (!menuId) return undefined;
    const close = (event) => {
      if (!event.target.closest('.book-menu-wrap')) setMenuId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuId]);

  const sortedBooks = useMemo(
    () =>
      [...books].sort(
        (a, b) => new Date(b.lastOpenedAt || b.createdAt) - new Date(a.lastOpenedAt || a.createdAt),
      ),
    [books],
  );

  const filteredBooks = useMemo(
    () => sortedBooks.filter((book) => matchesFilter(book, filter)),
    [sortedBooks, filter],
  );

  const continueBook = sortedBooks[0];
  const searchedBooks = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return books.filter((book) =>
      `${book.title} ${book.author}`.toLowerCase().includes(q),
    );
  }, [books, query]);

  const openRename = (book) => {
    setMenuId(null);
    setRenameTarget(book);
    setRenameValue(book.title);
  };

  const saveRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setRenaming(true);
    try {
      await api.updateBook(renameTarget.id, { title: renameValue.trim() });
      await refresh(true);
      setRenameTarget(null);
      toast('书名已更新');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRenaming(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteBook(deleteTarget.id);
      await refresh(true);
      toast(`《${deleteTarget.title}》已移出书架`);
      setDeleteTarget(null);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  return (
    <div className="page library-page">
      <header className="library-head">
        <div>
          <p className="eyebrow">READING DESK · {today}</p>
          <h1>{greeting()}，<em>今天读点什么？</em></h1>
          <p className="page-sub">
            {books.length
              ? `书架上有 ${books.length} 本书，慢慢读，比较快。`
              : '把第一本书放上书架，开始你的阅读空间。'}
          </p>
        </div>
        <div className="library-actions">
          <div className="search-box">
            <Search size={17} />
            <input
              ref={searchRef}
              data-global-search
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
              }}
              placeholder="搜索书名、作者或正文…"
              aria-label="搜索书库"
            />
            {query ? (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="清除搜索">
                <X size={14} />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>
            <Plus size={17} /> 导入内容
          </button>
        </div>
      </header>

      {query.trim() ? (
        <section className="search-results page-enter">
          <div className="section-head">
            <div>
              <p className="eyebrow">SEARCH</p>
              <h2>搜索 “{query.trim()}”</h2>
            </div>
            <span className="muted">
              {searching ? '正在翻找…' : `${searchedBooks.length + (results?.hits?.length || 0)} 个结果`}
            </span>
          </div>

          {searchedBooks.length ? (
            <div className="search-group">
              <h3 className="group-label">书名与作者</h3>
              <div className="result-books">
                {searchedBooks.map((book) => (
                  <button key={book.id} type="button" className="result-book" onClick={() => openBook(book)}>
                    <BookCover book={book} size="xs" flat />
                    <span className="result-book-main">
                      <strong><HighlightedText text={book.title} query={query.trim()} /></strong>
                      <span>{book.author || '佚名'} · {FORMAT_NAMES[book.format] || book.format}</span>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {results?.hits?.length ? (
            <div className="search-group">
              <h3 className="group-label">正文命中</h3>
              <div className="content-hits">
                {results.hits.map((hit, index) => (
                  <button
                    key={`${hit.bookId}-${hit.chapterIndex}-${index}`}
                    type="button"
                    className="content-hit"
                    onClick={() => openBook(hit.bookId, { chapter: hit.chapterIndex, page: hit.page, q: query.trim() })}
                  >
                    <span className="hit-source">
                      <span className={`format-dot fmt-${hit.format}`} />
                      《{hit.bookTitle}》· {hit.page ? `第 ${hit.page} 页` : truncate(hit.chapterTitle, 24)}
                    </span>
                    <span className="hit-snippet">
                      <HighlightedText text={hit.snippet} query={query.trim()} />
                    </span>
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!searching && !searchedBooks.length && !results?.hits?.length ? (
            <div className="search-empty">
              <Search size={26} />
              <h3>没有找到相关内容</h3>
              <p>试试更短的关键词，或换一个说法。</p>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          {continueBook ? (
            <section className="continue-layout">
              <div className="continue-card">
                <span className="continue-ring ring-a" />
                <span className="continue-ring ring-b" />
                <div className="continue-copy">
                  <p className="continue-kicker">
                    <BookOpen size={14} />
                    {continueBook.progress?.ratio > 0 || continueBook.progress?.chapterIndex > 0
                      ? '继续上次的阅读'
                      : '从这本书开始'}
                  </p>
                  <h2>{continueBook.title}</h2>
                  <p className="continue-excerpt">{truncate(continueBook.excerpt, 108)}</p>
                  <div className="continue-progress">
                    <div className="continue-progress-meta">
                      <span>{continueBook.author || '佚名'}</span>
                      <span>{Math.round(progressPercent(continueBook))}%</span>
                    </div>
                    <div className="progress-track">
                      <span style={{ width: `${Math.max(2, progressPercent(continueBook))}%` }} />
                    </div>
                  </div>
                  <div className="continue-actions">
                    <button type="button" className="btn btn-cream" onClick={() => openBook(continueBook)}>
                      继续阅读 <ArrowRight size={16} />
                    </button>
                    <span className="continue-format">
                      {FORMAT_NAMES[continueBook.format] || continueBook.format} ·{' '}
                      {continueBook.chapterCount || 1} 节
                    </span>
                  </div>
                </div>
                <div className="continue-cover-wrap">
                  <BookCover book={continueBook} size="lg" />
                  <span className="cover-shadow" />
                </div>
                <p className="continue-quote">“阅读，是借别人的灯，照自己的路。”</p>
              </div>

              <aside className="desk-card">
                <div className="desk-card-head">
                  <p className="eyebrow">YOUR DESK</p>
                  <Sparkles size={17} />
                </div>
                <h3>阅读台近况</h3>
                <div className="desk-stats">
                  <div>
                    <strong>{formatNumber(stats?.books || books.length)}</strong>
                    <span>本藏书</span>
                  </div>
                  <div>
                    <strong>{formatNumber(stats?.words || 0)}</strong>
                    <span>字等待被读</span>
                  </div>
                  <div>
                    <strong>{maps.length}</strong>
                    <span>张思维导图</span>
                  </div>
                  <div>
                    <strong>{threads.length}</strong>
                    <span>段问答</span>
                  </div>
                </div>
                <div className="desk-quote">
                  <p>“慢一点，让一句话在心里多待一会儿。”</p>
                  <span>— 来自书架上的示例</span>
                </div>
                <button type="button" className="text-link" onClick={() => navigate('/ask')}>
                  去问点什么 <ArrowRight size={14} />
                </button>
              </aside>
            </section>
          ) : null}

          <section className="concept-home">
            <div className="concept-home-head">
              <div>
                <p className="eyebrow">CONCEPT TREE · 跨书研究</p>
                <h2>概念树 <span className="count">{concepts.length}</span></h2>
                <p>从不同书的原文里提取概念、引文与关系，独立于单本书笔记。</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/concepts')}>
                <TreePine size={15} /> 进入概念树
              </button>
            </div>
            {concepts.length ? (
              <div className="concept-home-grid">
                {concepts.slice(0, 3).map((concept) => (
                  <button
                    key={concept.id}
                    type="button"
                    className="concept-home-card"
                    onClick={() => navigate(`/concepts/${concept.id}`)}
                  >
                    <span className="concept-home-icon"><TreePine size={18} /></span>
                    <span className="concept-home-copy">
                      <strong>{concept.title}</strong>
                      <small>
                        {concept.bookTitles?.length ? `${concept.bookTitles.length} 本书` : '跨书整理'}
                        {' · '}{concept.nodeCount} 个概念 · {concept.quoteCount} 条引文
                      </small>
                      <span>{truncate(concept.description, 70)}</span>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                ))}
                <button type="button" className="concept-home-add" onClick={() => navigate('/concepts')}>
                  <Plus size={18} />
                  <span>新建概念树</span>
                </button>
              </div>
            ) : (
              <button type="button" className="concept-home-empty" onClick={() => navigate('/concepts')}>
                <span><TreePine size={24} /></span>
                <strong>从几本书里长出一棵概念树</strong>
                <small>选定主题与书籍，AI 会带原书引文梳理关系</small>
                <em>开始梳理 <ArrowRight size={13} /></em>
              </button>
            )}
          </section>

          <section className="shelf-section">
            <div className="shelf-head">
              <div>
                <p className="eyebrow">YOUR LIBRARY</p>
                <h2>全部藏书 <span className="count">{filteredBooks.length}</span></h2>
              </div>
              <div className="filter-tabs">
                {FILTERS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cx('filter-tab', filter === item && 'is-active')}
                    onClick={() => setFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {books.length === 0 ? (
              <div className="empty-shelf">
                <span className="empty-glyph">页</span>
                <h3>书架还是空的</h3>
                <p>导入一本 TXT、PDF 或 Word，或者从微信公众号文章开始。</p>
                <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>
                  <Plus size={17} /> 导入第一本书
                </button>
              </div>
            ) : filteredBooks.length === 0 ? (
              <div className="empty-shelf compact">
                <LibraryBig size={28} />
                <h3>这个分类还没有书</h3>
                <p>换个筛选，或导入新的内容。</p>
              </div>
            ) : (
              <div className="book-grid">
                {filteredBooks.map((book) => (
                  <article className="book-card" key={book.id}>
                    <button type="button" className="book-card-open" onClick={() => openBook(book)}>
                      <BookCover book={book} size="md" />
                      <div className="book-card-info">
                        <div className="book-card-title-row">
                          <h3>{book.title}</h3>
                          {book.isDemo ? <span className="demo-badge">示例</span> : null}
                        </div>
                        <p className="book-author">{book.author || '佚名'}</p>
                        <div className="book-card-meta">
                          <span className={`format-tag fmt-${book.format}`}>
                            {FORMAT_LABELS[book.format] || book.format}
                          </span>
                          <span>{book.chapterCount || 1} 节</span>
                          <span>{formatNumber(book.wordCount || 0)} 字</span>
                        </div>
                        <div className="book-card-progress">
                          <span className="mini-track">
                            <i style={{ width: `${progressPercent(book)}%` }} />
                          </span>
                          <span>{Math.round(progressPercent(book))}%</span>
                        </div>
                      </div>
                    </button>
                    <div className="book-menu-wrap">
                      <button
                        type="button"
                        className="book-menu-btn"
                        aria-label="书籍操作"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuId(menuId === book.id ? null : book.id);
                        }}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {menuId === book.id ? (
                        <div className="book-menu">
                          <button type="button" onClick={() => { setMenuId(null); openBook(book); }}>
                            <BookOpen size={15} /> 打开阅读
                          </button>
                          <button type="button" onClick={() => openRename(book)}>
                            <FileText size={15} /> 重命名
                          </button>
                          <button type="button" className="danger" onClick={() => { setMenuId(null); setDeleteTarget(book); }}>
                            <Trash2 size={15} /> 移出书架
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
                <button type="button" className="add-book-tile" onClick={() => setImportOpen(true)}>
                  <span className="add-tile-icon"><Plus size={22} /></span>
                  <strong>添加新内容</strong>
                  <span>文件、网页或粘贴正文</span>
                </button>
              </div>
            )}
          </section>
        </>
      )}

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="重命名这本书"
        eyebrow="EDIT TITLE"
        width={440}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRenameTarget(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={saveRename} disabled={renaming || !renameValue.trim()}>
              {renaming ? '保存中…' : '保存书名'}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="rename-title">书名</label>
          <input
            id="rename-title"
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveRename();
            }}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="确定移出书架？"
        eyebrow="REMOVE BOOK"
        width={430}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>
              再想想
            </button>
            <button type="button" className="btn btn-danger" onClick={confirmDelete}>
              <Trash2 size={16} /> 移出书架
            </button>
          </>
        }
      >
        <p className="modal-text">
          将删除《{deleteTarget?.title}》的正文、原始文件与阅读进度。关联的思维导图会保留，但会失去书籍链接。
        </p>
      </Modal>
    </div>
  );
}
