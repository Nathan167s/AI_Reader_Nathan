import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  MessageCircleQuestion,
  Minus,
  Network,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  SunMedium,
  X,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import { READER_THEMES } from '../prefs.js';
import { cx, clamp, navigate, truncate } from '../utils.js';
import ContextMenu from '../components/ContextMenu.jsx';
import PdfViewer from '../reader/PdfViewer.jsx';
import ReaderAskPanel from '../reader/ReaderAskPanel.jsx';
import ReaderMapPanel from '../reader/ReaderMapPanel.jsx';
import ReaderNotesPanel from '../reader/ReaderNotesPanel.jsx';
import PagedReader from '../reader/PagedReader.jsx';

const DOCK_WIDTH_KEY = 'pagenest.reader.dockWidth.v1';
const DOCK_PIN_KEY = 'pagenest.reader.dockPinned.v1';
const DEFAULT_DOCK_WIDTH = 390;
const DOCK_MIN_WIDTH = 320;
const DOCK_MAX_WIDTH = 760;

function getSelectedText(root) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return '';
  const range = selection.getRangeAt(0);
  if (root && !root.contains(range.commonAncestorContainer)) return '';
  return selection.toString().replace(/\s+/g, ' ').trim();
}

function selectSentenceAtPoint(x, y, root) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  }
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return '';
  const node = range.startContainer;
  if (!root?.contains(node)) return '';
  const text = node.textContent || '';
  if (!text.trim()) return '';
  const offset = Math.min(range.startOffset, text.length);
  const stops = '。！？!?；;\n';
  let start = offset;
  let end = offset;
  while (start > 0 && !stops.includes(text[start - 1])) start -= 1;
  while (end < text.length && !stops.includes(text[end])) end += 1;
  if (end < text.length && stops.includes(text[end])) end += 1;
  const snippet = text.slice(start, end).trim();
  if (!snippet) return '';
  const selection = window.getSelection();
  selection.removeAllRanges();
  const next = document.createRange();
  next.setStart(node, start);
  next.setEnd(node, end);
  selection.addRange(next);
  return snippet.replace(/\s+/g, ' ').trim();
}

function clearSearchMarks(root) {
  if (!root) return;
  const marks = root.querySelectorAll('mark.search-hit');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
    parent?.normalize();
  });
}

function highlightInHtml(root, query) {
  if (!root || !query?.trim()) return null;
  clearSearchMarks(root);
  const needle = query.trim();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest('script,style,mark.search-hit')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let first = null;
  let count = 0;
  for (const textNode of nodes) {
    let current = textNode;
    let text = current.textContent || '';
    let lower = text.toLowerCase();
    let index = lower.indexOf(needle.toLowerCase());
    while (index >= 0 && count < 40) {
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      const after = current.splitText(index);
      after.splitText(needle.length);
      mark.textContent = after.textContent;
      after.parentNode.replaceChild(mark, after);
      if (!first) first = mark;
      count += 1;
      current = mark.nextSibling;
      if (!current) break;
      text = current.textContent || '';
      lower = text.toLowerCase();
      index = lower.indexOf(needle.toLowerCase());
    }
    if (count >= 40) break;
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return first;
}

async function copyPlain(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function flattenOutline(items, depth = 0) {
  const out = [];
  for (const item of items || []) {
    out.push({ title: item.title, page: item.page, depth });
    if (item.children?.length) out.push(...flattenOutline(item.children, depth + 1));
  }
  return out;
}

function ReaderSkeleton() {
  return (
    <div className="reader-fatal">
      <span className="reader-loader"><Loader2 size={22} className="spin" /></span>
      <p>正在展开书页…</p>
    </div>
  );
}

export default function Reader({ bookId, book }) {
  const {
    books,
    route,
    prefs,
    setPrefs,
    toast,
  } = useApp();
  const [content, setContent] = useState(null);
  const [bookMeta, setBookMeta] = useState(book || null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [chapterIndex, setChapterIndex] = useState(0);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfState, setPdfState] = useState({ pages: 0, outline: [] });
  const [tocOpen, setTocOpen] = useState(false);
  const [tocCollapsed, setTocCollapsed] = useState(
    () => localStorage.getItem('pagenest.reader.tocCollapsed') === '1',
  );
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectionTip, setSelectionTip] = useState(null);
  const [dockTab, setDockTab] = useState('ask');
  const [dockOpen, setDockOpen] = useState(false);
  const [dockMounted, setDockMounted] = useState(false);
  const [dockPinned, setDockPinned] = useState(
    () => localStorage.getItem(DOCK_PIN_KEY) === '1',
  );
  const [dockWidth, setDockWidth] = useState(() => {
    const raw = localStorage.getItem(DOCK_WIDTH_KEY);
    const stored = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(stored)
      ? clamp(stored, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH)
      : DEFAULT_DOCK_WIDTH;
  });
  const [dockResizing, setDockResizing] = useState(false);
  const [dockPrompt, setDockPrompt] = useState(null);
  const [notePrompt, setNotePrompt] = useState(null);

  const scrollRef = useRef(null);
  const mainRef = useRef(null);
  const articleRef = useRef(null);
  const searchInputRef = useRef(null);
  const appearanceRef = useRef(null);
  const pdfRef = useRef(null);
  const pagedRef = useRef(null);
  const restoreRef = useRef(null);
  const restoredRef = useRef(false);
  const progressRef = useRef({ chapterIndex: 0, ratio: 0, page: 1 });
  const saveTimerRef = useRef(null);
  const prevReadingModeRef = useRef(prefs.readingMode || 'scroll');

  useEffect(() => {
    localStorage.setItem('pagenest.reader.tocCollapsed', tocCollapsed ? '1' : '0');
  }, [tocCollapsed]);

  useEffect(() => {
    localStorage.setItem(DOCK_WIDTH_KEY, String(dockWidth));
  }, [dockWidth]);

  useEffect(() => {
    localStorage.setItem(DOCK_PIN_KEY, dockPinned ? '1' : '0');
    if (dockPinned) {
      setDockMounted(true);
      setDockOpen(true);
    }
  }, [dockPinned]);

  useEffect(() => {
    const onResize = () => {
      const maxWidth = Math.max(
        DOCK_MIN_WIDTH,
        Math.min(DOCK_MAX_WIDTH, window.innerWidth - 520),
      );
      setDockWidth((current) => clamp(current, DOCK_MIN_WIDTH, maxWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isPdf = content?.format === 'pdf' || bookMeta?.format === 'pdf';
  const pdfTextPages = content?.pdf?.textPages;
  const chapters = content?.chapters || [];
  const activeChapter = chapters[chapterIndex] || chapters[0];
  const safeChapterHtml = useMemo(
    () =>
      DOMPurify.sanitize(activeChapter?.html || '', {
        ADD_ATTR: ['target', 'rel', 'referrerpolicy', 'loading'],
      }),
    [activeChapter],
  );
  const currentBook = bookMeta || books.find((item) => item.id === bookId) || book;
  const totalPages = pdfState.pages || content?.pdf?.pages || currentBook?.chapterCount || 1;

  const progress = isPdf
    ? Math.min(100, Math.max(0, ((pdfPage - 1 + scrollRatio) / Math.max(1, totalPages)) * 100))
    : Math.min(
        100,
        Math.max(0, ((chapterIndex + scrollRatio) / Math.max(1, chapters.length || 1)) * 100),
      );

  const chapterLabel = isPdf
    ? `第 ${pdfPage} / ${totalPages} 页`
    : truncate(activeChapter?.title || '', 40);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    api
      .getContent(bookId)
      .then((data) => {
        if (!alive) return;
        setContent(data);
        setBookMeta(data.book);
        const chapterParam = route.query.get('chapter');
        const initialChapter = Math.min(
          Math.max(
            0,
            chapterParam !== null
              ? Number(chapterParam)
              : Number(data.book?.progress?.chapterIndex) || 0,
          ),
          Math.max(0, (data.chapters?.length || 1) - 1),
        );
        setChapterIndex(initialChapter);
        const query = route.query.get('q') || '';
        if (query) {
          setSearchQuery(query);
          setPendingHighlight({ q: query, nonce: Date.now() });
        }
        const initialPage = Math.max(1, Number(route.query.get('page')) || data.book?.progress?.page || 1);
        setPdfPage(initialPage);
        if (data.format !== 'pdf') {
          const requestedChapter = route.query.has('chapter');
          const progressChapter = Number(data.book?.progress?.chapterIndex) || 0;
          const sameChapter = !requestedChapter && initialChapter === progressChapter;
          const initialRatio = sameChapter ? Number(data.book?.progress?.ratio) || 0 : 0;
          restoreRef.current = {
            chapter: initialChapter,
            ratio: initialRatio,
          };
          restoredRef.current = !(initialRatio > 0);
        } else {
          restoreRef.current = { page: initialPage };
        }
        progressRef.current = {
          chapterIndex: initialChapter,
          ratio:
            data.format !== 'pdf' && !route.query.has('chapter')
              ? Number(data.book?.progress?.ratio) || 0
              : 0,
          page: initialPage,
        };
        setLoading(false);
        if (query && data.format === 'pdf') {
          setTimeout(() => pdfRef.current?.goToPage(initialPage), 380);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(err.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

  useEffect(() => {
    if (!content || isPdf) return undefined;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      const target = restoreRef.current;
      if (!restoredRef.current && target && target.chapter === chapterIndex) {
        const max = Math.max(0, element.scrollHeight - element.clientHeight);
        element.scrollTop = max * Math.min(1, Math.max(0, target.ratio || 0));
        restoredRef.current = true;
        setScrollRatio(target.ratio || 0);
      } else {
        restoredRef.current = true;
        setScrollRatio(0);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [chapterIndex, content, isPdf]);

  useEffect(() => {
    if (prevReadingModeRef.current === prefs.readingMode) return undefined;
    prevReadingModeRef.current = prefs.readingMode;
    if (isPdf || prefs.readingMode !== 'scroll') return undefined;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      const max = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = max * Math.min(1, Math.max(0, scrollRatio || 0));
    });
    return () => cancelAnimationFrame(frame);
    // 只在切换回滚动模式时同步 PagedReader 的进度
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.readingMode, isPdf]);

  useEffect(() => {
    if (!pendingHighlight || isPdf) return undefined;
    const timer = setTimeout(() => {
      const target =
        articleRef.current || document.querySelector('.paged-reader .article-body');
      if (target) highlightInHtml(target, pendingHighlight.q);
    }, 160);
    return () => clearTimeout(timer);
  }, [pendingHighlight, chapterIndex, isPdf, content, prefs.readingMode]);

  useEffect(() => {
    if (!isPdf || !pdfState.pages) return undefined;
    const query = route.query.get('q');
    if (!query) return undefined;
    setSearchOpen(true);
    const page = Number(route.query.get('page')) || 1;
    const timer = setTimeout(() => {
      pdfRef.current?.highlightQuery(page, query);
    }, 720);
    return () => clearTimeout(timer);
  }, [isPdf, pdfState.pages, route.query]);

  useEffect(() => {
    if (!searchOpen) return;
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      setSearchBusy(false);
      return undefined;
    }
    let alive = true;
    setSearchBusy(true);
    setSearchTouched(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchBook(bookId, searchQuery.trim());
        if (alive) setSearchResults(data.hits || []);
      } catch (err) {
        if (alive) toast(err.message, 'error');
      } finally {
        if (alive) setSearchBusy(false);
      }
    }, 280);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchQuery, searchOpen, bookId, toast]);

  useEffect(() => {
    if (!appearanceOpen) return undefined;
    const onPointer = (event) => {
      if (!appearanceRef.current?.contains(event.target)) setAppearanceOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [appearanceOpen]);

  useEffect(() => {
    if (!selectionTip) return undefined;
    const hide = (event) => {
      if (event.target.closest?.('.selection-tip')) return;
      setSelectionTip(null);
    };
    document.addEventListener('pointerdown', hide, true);
    return () => document.removeEventListener('pointerdown', hide, true);
  }, [selectionTip]);

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setContextMenu(null);
        setSelectionTip(null);
        setTocOpen(false);
        setAppearanceOpen(false);
        setDockOpen(false);
        setDockPinned(false);
      }
      if (!typing && !searchOpen && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !isPdf) {
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        if (prefs.readingMode === 'paged') {
          event.preventDefault();
          pagedRef.current?.turnPage(delta);
          return;
        }
        const next = chapterIndex + delta;
        if (next >= 0 && next < chapters.length) {
          event.preventDefault();
          setChapter(next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapterIndex, chapters.length, isPdf, searchOpen, prefs.readingMode]);

  const setChapter = useCallback(
    (index) => {
      if (index < 0 || index >= chapters.length || index === chapterIndex) {
        if (index === chapterIndex) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      restoredRef.current = true;
      setChapterIndex(index);
      setScrollRatio(0);
      setSelectionTip(null);
      setContextMenu(null);
      scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    },
    [chapters.length, chapterIndex],
  );

  const openDock = useCallback(
    (tab) => {
      if (dockOpen && dockTab === tab) {
        if (!dockPinned) setDockOpen(false);
        return;
      }
      setDockTab(tab);
      setDockMounted(true);
      setDockOpen(true);
      setAppearanceOpen(false);
      setSelectionTip(null);
    },
    [dockOpen, dockTab, dockPinned],
  );

  const closeDock = useCallback(() => {
    setDockOpen(false);
    setDockPinned(false);
  }, []);

  const beginDockResize = useCallback(
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = dockWidth;
      const maxWidth = Math.max(
        DOCK_MIN_WIDTH,
        Math.min(DOCK_MAX_WIDTH, window.innerWidth - 520),
      );
      setDockResizing(true);
      document.body.classList.add('is-resizing-dock');
      const onMove = (moveEvent) => {
        const next = startWidth + (startX - moveEvent.clientX);
        setDockWidth(Math.round(clamp(next, DOCK_MIN_WIDTH, maxWidth)));
      };
      const finish = () => {
        setDockResizing(false);
        document.body.classList.remove('is-resizing-dock');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [dockWidth],
  );

  const jumpToSource = useCallback(
    (source) => {
      if (!source || source.bookId !== bookId) return;
      if (isPdf && source.page) {
        const page = Math.max(1, Number(source.page) || 1);
        setPdfPage(page);
        pdfRef.current?.goToPage(page);
        return;
      }
      if (Number.isInteger(source.chapterIndex)) setChapter(source.chapterIndex);
    },
    [bookId, isPdf, setChapter],
  );

  const consumeDockPrompt = useCallback(() => setDockPrompt(null), []);
  const consumeNotePrompt = useCallback(() => setNotePrompt(null), []);

  const saveProgress = useCallback(
    (payload) => {
      const next = { ...progressRef.current, ...payload, updatedAt: new Date().toISOString() };
      progressRef.current = next;
      api.saveProgress(bookId, next).catch(() => {});
    },
    [bookId],
  );

  useEffect(() => {
    if (!content) return undefined;
    clearTimeout(saveTimerRef.current);
    const timer = setTimeout(() => {
      if (isPdf) {
        saveProgress({ chapterIndex: pdfPage - 1, page: pdfPage, ratio: scrollRatio });
      } else {
        saveProgress({ chapterIndex, page: 1, ratio: scrollRatio });
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [chapterIndex, scrollRatio, pdfPage, isPdf, content, saveProgress]);

  useEffect(() => {
    const bookIdRef = bookId;
    return () => {
      const current = progressRef.current;
      const body = JSON.stringify(current);
      try {
        fetch(`/api/books/${bookIdRef}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      } catch {
        // 离开页面时尽力保存
      }
    };
  }, [bookId]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const max = element.scrollHeight - element.clientHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, element.scrollTop / max)) : 0;
    setScrollRatio(ratio);
    progressRef.current.ratio = ratio;
  };

  const handleSelection = () => {
    if (contextMenu) return;
    const text = getSelectedText(mainRef.current);
    if (!text || text.length < 2) {
      setSelectionTip(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    setSelectionTip({
      x: Math.min(window.innerWidth - 210, Math.max(12, rect.left + rect.width / 2 - 100)),
      y: Math.max(12, rect.top - 52),
      text,
    });
  };

  const handleContextMenu = (event) => {
    const root = mainRef.current;
    if (!root) return;
    setSelectionTip(null);
    const selected = getSelectedText(root);
    const text = selected || selectSentenceAtPoint(event.clientX, event.clientY, root);
    if (!text) return;
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      text,
    });
  };

  const searchInBook = (text) => {
    setSearchOpen(true);
    setSearchQuery(text);
  };

  const askSelection = (text) => {
    setDockTab('ask');
    setDockMounted(true);
    setDockOpen(true);
    setDockPrompt({ text, nonce: Date.now() });
    setSelectionTip(null);
    setContextMenu(null);
    setAppearanceOpen(false);
  };

  const noteSelection = (text) => {
    setDockTab('notes');
    setDockMounted(true);
    setDockOpen(true);
    setNotePrompt({ text, nonce: Date.now() });
    setSelectionTip(null);
    setContextMenu(null);
    setAppearanceOpen(false);
  };

  const handleCopy = async (text) => {
    const ok = await copyPlain(text);
    toast(ok ? '已复制选中内容' : '复制失败，请手动选择复制', ok ? 'success' : 'error');
  };

  const jumpToHit = (hit) => {
    const q = searchQuery.trim();
    if (isPdf) {
      const page = hit.page || 1;
      setPdfPage(page);
      pdfRef.current?.goToPage(page);
      setTimeout(() => pdfRef.current?.highlightQuery(page, q), 320);
      return;
    }
    setChapter(hit.chapterIndex);
    setPendingHighlight({ q, nonce: Date.now() });
    if (prefs.readingMode === 'paged') {
      setTimeout(() => pagedRef.current?.goToText?.(q), 260);
    }
  };

  const handlePdfPage = (page, ratio) => {
    setPdfPage(page);
    setScrollRatio(ratio || 0);
    progressRef.current = { ...progressRef.current, chapterIndex: page - 1, page, ratio: ratio || 0 };
  };

  const outline = flattenOutline(pdfState.outline);
  const pageJumps = (() => {
    if (!isPdf) return [];
    const pages = totalPages;
    if (pages <= 80) return Array.from({ length: pages }, (_, index) => index + 1);
    const step = Math.ceil(pages / 24);
    const list = [];
    for (let page = 1; page <= pages; page += step) list.push(page);
    if (list[list.length - 1] !== pages) list.push(pages);
    return list;
  })();

  if (loading) return <ReaderSkeleton />;

  if (loadError) {
    return (
      <div className="reader-fatal">
        <span className="fatal-glyph">页</span>
        <h2>没能打开这本书</h2>
        <p>{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/library')}>
          回到书架
        </button>
      </div>
    );
  }

  return (
    <div
      className={cx(
        'reader-page',
        `reader-theme-${prefs.theme}`,
        tocCollapsed && 'is-toc-collapsed',
      )}
      style={{
        '--reader-font-size': `${prefs.fontSize}px`,
        '--reader-line-height': prefs.lineHeight,
        '--reader-column': `${prefs.width}px`,
      }}
    >
      <div className="reader-progress-line" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <header className="reader-topbar">
        <div className="reader-top-left">
          <button type="button" className="reader-icon-btn" onClick={() => navigate('/library')} title="返回书架">
            <ArrowLeft size={19} />
          </button>
          <div className="reader-title-block">
            <span className="reader-book-name">{currentBook?.title || '阅读'}</span>
            <span className="reader-chapter-name">{chapterLabel}</span>
          </div>
        </div>

        <div className="reader-top-actions">
          <button
            type="button"
            className="reader-action search-action"
            onClick={() => setSearchOpen(true)}
            title="在本书中搜索 (Ctrl+F)"
          >
            <Search size={17} />
            <span>搜索</span>
            <kbd>⌘F</kbd>
          </button>
          <button
            type="button"
            className={cx('reader-icon-btn', dockOpen && dockTab === 'ask' && 'is-active')}
            onClick={() => openDock('ask')}
            title="侧边问答"
          >
            <MessageCircleQuestion size={18} />
          </button>
          <button
            type="button"
            className={cx('reader-icon-btn', dockOpen && dockTab === 'map' && 'is-active')}
            onClick={() => openDock('map')}
            title="本书思维导图"
          >
            <Network size={18} />
          </button>
          <button
            type="button"
            className={cx('reader-icon-btn', dockOpen && dockTab === 'notes' && 'is-active')}
            onClick={() => openDock('notes')}
            title="本书笔记"
          >
            <StickyNote size={18} />
          </button>
          <div className="appearance-wrap" ref={appearanceRef}>
            <button
              type="button"
              className={cx('reader-icon-btn', appearanceOpen && 'is-active')}
              onClick={() => setAppearanceOpen((value) => !value)}
              title="阅读外观"
            >
              <SlidersHorizontal size={18} />
            </button>
            {appearanceOpen ? (
              <div className="appearance-pop">
                <div className="pop-head">
                  <strong>阅读外观</strong>
                  <button type="button" className="icon-btn tiny" onClick={() => setAppearanceOpen(false)}>
                    <X size={14} />
                  </button>
                </div>
                <div className="appearance-row">
                  <span>字号</span>
                  <div className="stepper">
                    <button
                      type="button"
                      onClick={() => setPrefs({ fontSize: Math.max(15, prefs.fontSize - 1) })}
                      aria-label="减小字号"
                    >
                      <Minus size={14} />
                    </button>
                    <b>{prefs.fontSize}</b>
                    <button
                      type="button"
                      onClick={() => setPrefs({ fontSize: Math.min(26, prefs.fontSize + 1) })}
                      aria-label="增大字号"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div className="appearance-row">
                  <span>行距</span>
                  <div className="segmented small">
                    {[1.7, 2, 2.2].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={prefs.lineHeight === value ? 'is-active' : ''}
                        onClick={() => setPrefs({ lineHeight: value })}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="appearance-row">
                  <span>版心</span>
                  <div className="segmented small">
                    {[
                      { label: '窄', value: 620 },
                      { label: '中', value: 720 },
                      { label: '宽', value: 820 },
                    ].map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={prefs.width === item.value ? 'is-active' : ''}
                        onClick={() => setPrefs({ width: item.value })}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="appearance-row">
                  <span>阅读方式</span>
                  <div className="segmented small">
                    <button
                      type="button"
                      className={(prefs.readingMode || 'scroll') === 'scroll' ? 'is-active' : ''}
                      onClick={() => setPrefs({ readingMode: 'scroll' })}
                    >
                      滚动
                    </button>
                    <button
                      type="button"
                      className={prefs.readingMode === 'paged' ? 'is-active' : ''}
                      onClick={() => setPrefs({ readingMode: 'paged' })}
                    >
                      翻页
                    </button>
                  </div>
                </div>
                <div className="appearance-themes">
                  <span>纸张</span>
                  <div className="theme-swatches">
                    {READER_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={cx('theme-swatch', prefs.theme === theme.id && 'is-active')}
                        style={{ '--swatch-bg': theme.color, '--swatch-ink': theme.ink }}
                        onClick={() => setPrefs({ theme: theme.id })}
                        title={theme.name}
                        aria-label={theme.name}
                      >
                        {prefs.theme === theme.id ? <Check size={12} /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={cx(
              'reader-icon-btn',
              (tocOpen || !tocCollapsed) && 'is-active',
            )}
            onClick={() => {
              if (window.matchMedia('(max-width: 980px)').matches) {
                setTocOpen((value) => !value);
              } else {
                setTocCollapsed((value) => !value);
              }
            }}
            title={tocCollapsed ? '展开目录' : '隐藏目录'}
            aria-pressed={!tocCollapsed}
          >
            <List size={19} />
          </button>
        </div>
      </header>

      <div
        className={cx(
          'reader-layout',
          dockOpen && 'has-dock',
          dockResizing && 'is-resizing-dock',
        )}
        style={{ '--dock-width': `${dockWidth}px` }}
      >
        <aside className={cx('reader-toc', tocOpen && 'is-open')}>
          <div className="toc-head">
            <div>
              <p className="eyebrow">CONTENTS</p>
              <h2>目录</h2>
            </div>
            <div className="toc-head-actions">
              <button
                type="button"
                className="icon-btn toc-collapse"
                onClick={() => {
                  if (window.matchMedia('(max-width: 980px)').matches) setTocOpen(false);
                  else setTocCollapsed(true);
                }}
                title="隐藏目录"
              >
                <PanelLeftClose size={17} />
              </button>
              <button type="button" className="icon-btn toc-close" onClick={() => setTocOpen(false)} aria-label="关闭目录">
                <X size={17} />
              </button>
            </div>
          </div>

          <div className="toc-book">
            <div className="toc-book-mark">
              {isPdf ? <BookOpen size={17} /> : <span>{chapterIndex + 1}</span>}
            </div>
            <div>
              <strong>{currentBook?.title}</strong>
              <span>
                {isPdf
                  ? `${totalPages} 页`
                  : `${chapters.length} 节 · 约 ${Math.max(1, Math.round((currentBook?.wordCount || 0) / 400))} 分钟`}
              </span>
            </div>
          </div>

          {isPdf ? (
            <nav className="toc-list">
              {outline.length ? (
                outline.map((item, index) => (
                  <button
                    key={`${item.title}-${item.page}-${index}`}
                    type="button"
                    className="toc-item"
                    style={{ paddingLeft: `${12 + item.depth * 13}px` }}
                    onClick={() => {
                      pdfRef.current?.goToPage(item.page);
                      setPdfPage(item.page);
                      setTocOpen(false);
                    }}
                  >
                    <span>{item.title || `第 ${item.page} 页`}</span>
                    <small>{item.page}</small>
                  </button>
                ))
              ) : (
                <div className="pdf-page-jumps">
                  <p className="toc-hint">按页浏览</p>
                  <div className="page-jump-grid">
                    {pageJumps.map((page) => (
                      <button
                        key={page}
                        type="button"
                        className={pdfPage === page ? 'is-active' : ''}
                        onClick={() => {
                          pdfRef.current?.goToPage(page);
                          setPdfPage(page);
                          setTocOpen(false);
                        }}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </nav>
          ) : (
            <nav className="toc-list">
              {chapters.map((chapter, index) => (
                <button
                  key={chapter.id || index}
                  type="button"
                  className={cx('toc-item', index === chapterIndex && 'is-active')}
                  onClick={() => {
                    setChapter(index);
                    setTocOpen(false);
                  }}
                >
                  <span className="toc-num">{String(index + 1).padStart(2, '0')}</span>
                  <span>{chapter.title}</span>
                </button>
              ))}
            </nav>
          )}

          <div className="toc-foot">
            <div className="toc-progress">
              <span>全书进度</span>
              <b>{Math.round(progress)}%</b>
            </div>
            <div className="progress-track thin">
              <span style={{ width: `${progress}%` }} />
            </div>
            <p>选中文字后右键，可直接搜索或提问。</p>
          </div>
        </aside>

        {tocOpen ? <button type="button" className="toc-backdrop" onClick={() => setTocOpen(false)} aria-label="关闭目录" /> : null}

        <main
          className={cx('reader-main', isPdf && 'is-pdf')}
          ref={mainRef}
          onContextMenu={handleContextMenu}
          onMouseUp={handleSelection}
        >
          {isPdf ? (
            <>
              {pdfTextPages === 0 ? (
                <div className="pdf-text-warning" role="status">
                  <BookOpen size={14} />
                  <span>
                    这份 PDF 没有可提取的文字层（扫描图片），选中文字与原文提问不可用。可先用 OCR
                    工具加文字层后重新导入，或用「粘贴正文」导入 OCR 结果。
                  </span>
                </div>
              ) : null}
              <PdfViewer
                ref={pdfRef}
                bookId={bookId}
                initialPage={Number(route.query.get('page')) || currentBook?.progress?.page || 1}
                onPageChange={handlePdfPage}
                onOutline={(outlineData, pages) => setPdfState({ outline: outlineData, pages })}
              />
            </>
          ) : prefs.readingMode === 'paged' ? (
            <PagedReader
              ref={pagedRef}
              book={currentBook}
              chapter={activeChapter}
              chapterIndex={chapterIndex}
              chapterCount={chapters.length}
              html={safeChapterHtml}
              initialRatio={
                progressRef.current.chapterIndex === chapterIndex
                  ? progressRef.current.ratio || 0
                  : 0
              }
              onProgress={setScrollRatio}
              onPrevChapter={() => setChapter(chapterIndex - 1)}
              onNextChapter={() => setChapter(chapterIndex + 1)}
            />
          ) : (
            <div className="reader-scroll" ref={scrollRef} onScroll={handleScroll}>
              <article className="reader-article">
                <header className="article-head">
                  <p className="article-eyebrow">
                    <span>第 {chapterIndex + 1} 节</span>
                    <i />
                    <span>{currentBook?.author || '佚名'}</span>
                  </p>
                  <h1>{activeChapter?.title}</h1>
                  <div className="article-meta">
                    <span>{currentBook?.title}</span>
                    <span>{Math.max(1, Math.round((currentBook?.wordCount || 0) / 400))} 分钟阅读</span>
                    {currentBook?.sourceType === 'wechat' ? <span>微信公众号</span> : null}
                  </div>
                  <div className="article-rule"><span /></div>
                </header>

                <div
                  className="article-body"
                  ref={articleRef}
                  dangerouslySetInnerHTML={{ __html: safeChapterHtml }}
                />

                <div className="reader-tip">
                  <Sparkles size={14} />
                  选中一段文字后右键，可搜索、复制，或直接问我。
                </div>

                <nav className="chapter-pager">
                  <button
                    type="button"
                    className="pager-btn prev"
                    disabled={chapterIndex === 0}
                    onClick={() => setChapter(chapterIndex - 1)}
                  >
                    <ChevronLeft size={18} />
                    <span>
                      <small>上一节</small>
                      {chapterIndex > 0 ? truncate(chapters[chapterIndex - 1]?.title, 22) : '已是第一节'}
                    </span>
                  </button>
                  <span className="pager-count">
                    {String(chapterIndex + 1).padStart(2, '0')} / {String(chapters.length).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    className="pager-btn next"
                    disabled={chapterIndex >= chapters.length - 1}
                    onClick={() => setChapter(chapterIndex + 1)}
                  >
                    <span>
                      <small>下一节</small>
                      {chapterIndex < chapters.length - 1 ? truncate(chapters[chapterIndex + 1]?.title, 22) : '已是最后一节'}
                    </span>
                    <ChevronRight size={18} />
                  </button>
                </nav>
              </article>
            </div>
          )}
        </main>

        {dockOpen ? (
          <div
            className={cx('dock-resizer', dockResizing && 'is-active')}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整问答侧栏宽度"
            title="拖动调整宽度，双击恢复默认"
            onPointerDown={beginDockResize}
            onDoubleClick={() => setDockWidth(DEFAULT_DOCK_WIDTH)}
          />
        ) : null}

      {dockMounted ? (
        <>
          {dockOpen ? (
            <button
              type="button"
              className="reader-dock-backdrop"
              onClick={closeDock}
              aria-label="关闭侧边模块"
            />
          ) : null}
          <aside className={cx('reader-dock', !dockOpen && 'is-hidden')}>
            <header className="reader-dock-head">
              <div className="reader-dock-tabs">
                <button
                  type="button"
                  className={cx(dockTab === 'ask' && 'is-active')}
                  onClick={() => setDockTab('ask')}
                >
                  <MessageCircleQuestion size={15} /> 问答
                </button>
                <button
                  type="button"
                  className={cx(dockTab === 'map' && 'is-active')}
                  onClick={() => setDockTab('map')}
                >
                  <Network size={15} /> 导图
                </button>
                <button
                  type="button"
                  className={cx(dockTab === 'notes' && 'is-active')}
                  onClick={() => setDockTab('notes')}
                >
                  <StickyNote size={15} /> 笔记
                </button>
              </div>
              <div className="reader-dock-head-actions">
                <button
                  type="button"
                  className={cx('dock-pin-btn', dockPinned && 'is-active')}
                  onClick={() => setDockPinned((value) => !value)}
                  title={dockPinned ? '取消常驻侧栏' : '常驻在侧边'}
                  aria-pressed={dockPinned}
                >
                  <Pin size={13} />
                  <span>{dockPinned ? '常驻中' : '常驻'}</span>
                </button>
                <button
                  type="button"
                  className="reader-icon-btn"
                  onClick={closeDock}
                  title="收起侧边模块"
                >
                  <X size={17} />
                </button>
              </div>
            </header>
            <div className="reader-dock-body">
              <div className={cx('dock-view', dockTab === 'ask' && 'is-active')}>
                <ReaderAskPanel
                  book={currentBook}
                  chapterIndex={isPdf ? Math.max(0, pdfPage - 1) : chapterIndex}
                  chapterTitle={isPdf ? `第 ${pdfPage} 页` : activeChapter?.title}
                  isPdf={isPdf}
                  pdfTextPages={pdfTextPages}
                  promptRequest={dockPrompt}
                  onPromptConsumed={consumeDockPrompt}
                  onJumpSource={jumpToSource}
                />
              </div>
              <div className={cx('dock-view', dockTab === 'map' && 'is-active')}>
                <ReaderMapPanel
                  book={currentBook}
                  chapterIndex={isPdf ? Math.max(0, pdfPage - 1) : chapterIndex}
                  chapterTitle={isPdf ? `第 ${pdfPage} 页` : activeChapter?.title}
                />
              </div>
              <div className={cx('dock-view', dockTab === 'notes' && 'is-active')}>
                <ReaderNotesPanel
                  book={currentBook}
                  chapterIndex={isPdf ? Math.max(0, pdfPage - 1) : chapterIndex}
                  chapterTitle={isPdf ? `第 ${pdfPage} 页` : activeChapter?.title}
                  page={isPdf ? pdfPage : null}
                  quoteRequest={notePrompt}
                  onPromptConsumed={consumeNotePrompt}
                />
              </div>
            </div>
          </aside>
        </>
      ) : null}
      </div>

      {searchOpen ? (
        <div className="find-layer" role="dialog" aria-label="本书搜索">
          <button type="button" className="find-backdrop" onClick={() => setSearchOpen(false)} aria-label="关闭搜索" />
          <aside className="find-drawer">
            <header className="find-head">
              <div>
                <p className="eyebrow">FIND IN BOOK</p>
                <h2>在本书中搜索</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSearchOpen(false)} aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="find-input">
              <Search size={16} />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearchOpen(false);
                  if (event.key === 'Enter' && searchResults[0]) jumpToHit(searchResults[0]);
                }}
                placeholder="输入关键词，回车跳转"
              />
              {searchBusy ? <Loader2 size={16} className="spin" /> : null}
            </div>
            <div className="find-summary">
              {searchQuery.trim()
                ? searchBusy
                  ? '正在书中查找…'
                  : `找到 ${searchResults.length} 处相关段落`
                : '搜索本书的正文，点击结果即可跳转'}
            </div>
            <div className="find-results">
              {searchResults.map((hit, index) => (
                <button
                  type="button"
                  className="find-hit"
                  key={`${hit.chapterIndex}-${index}`}
                  onClick={() => jumpToHit(hit)}
                >
                  <span className="find-hit-source">
                    {hit.page ? `第 ${hit.page} 页` : truncate(hit.chapterTitle, 24)}
                    {index === 0 ? <em>最佳匹配</em> : null}
                  </span>
                  <span className="find-hit-snippet">{hit.snippet}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
              {!searchBusy && searchTouched && searchQuery.trim() && searchResults.length === 0 ? (
                <div className="find-empty">
                  <Search size={22} />
                  <p>没有找到 “{searchQuery.trim()}”</p>
                  <span>试试更短的关键词，或检查是否有错别字。</span>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {contextMenu ? (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onSearchBook={searchInBook}
          onSearchLibrary={(text) => navigate(`/library?q=${encodeURIComponent(text)}`)}
          onAsk={askSelection}
          onNote={noteSelection}
          onCopy={handleCopy}
        />
      ) : null}

      {selectionTip ? (
        <div
          className="selection-tip"
          style={{ left: selectionTip.x, top: selectionTip.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { setSearchOpen(true); setSearchQuery(selectionTip.text); setSelectionTip(null); }}>
            <Search size={14} /> 搜
          </button>
          <button type="button" onClick={() => { askSelection(selectionTip.text); setSelectionTip(null); }}>
            <MessageCircleQuestion size={14} /> 问
          </button>
          <button type="button" onClick={() => { handleCopy(selectionTip.text); setSelectionTip(null); }}>
            复制
          </button>
        </div>
      ) : null}
    </div>
  );
}
