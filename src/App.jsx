import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from './context.jsx';
import { api } from './api.js';
import { navigate, parseRoute } from './utils.js';
import { loadPrefs, persistPrefs } from './prefs.js';
import Sidebar from './components/Sidebar.jsx';
import ImportDialog from './components/ImportDialog.jsx';
import DisplayControls from './components/DisplayControls.jsx';
import Library from './pages/Library.jsx';
import Reader from './pages/Reader.jsx';
import Ask from './pages/Ask.jsx';
import Maps from './pages/Maps.jsx';
import MapEditor from './pages/MapEditor.jsx';
import Concepts from './pages/Concepts.jsx';
import ConceptEditor from './pages/ConceptEditor.jsx';
import Settings from './pages/Settings.jsx';

function BrandLoader({ error, onRetry }) {
  return (
    <div className="boot-screen">
      <div className={`boot-mark ${error ? 'is-error' : ''}`}>
        <span>页</span>
        <i />
      </div>
      <h1>页间 <em>PageNest</em></h1>
      {error ? (
        <>
          <p className="boot-error">{error}</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            重新连接
          </button>
        </>
      ) : (
        <p className="boot-line">正在整理你的阅读桌<span className="typing-dots"><i /><i /><i /></span></p>
      )}
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [prefs, setPrefsState] = useState(() => loadPrefs());
  const timerRef = useRef(null);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const next = await api.bootstrap();
      setData(next);
      setError('');
      return next;
    } catch (err) {
      if (!quiet) setError(err.message || '无法连接到本地服务');
      throw err;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .bootstrap()
      .then((next) => {
        if (!alive) return;
        setData(next);
      })
      .catch((err) => {
        if (alive) setError(err.message || '无法连接到本地服务');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!window.location.hash) navigate('/library', { replace: true });
  }, []);

  useEffect(() => {
    persistPrefs(prefs);
  }, [prefs]);

  const toast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current.slice(-2), { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  const setPrefs = useCallback((patch) => {
    setPrefsState((current) => ({ ...current, ...patch }));
  }, []);

  const openBook = useCallback((book, options = {}) => {
    const id = typeof book === 'string' ? book : book?.id;
    if (!id) return;
    const params = new URLSearchParams();
    if (options.chapter !== undefined) params.set('chapter', options.chapter);
    if (options.page !== undefined) params.set('page', options.page);
    if (options.q) params.set('q', options.q);
    navigate(`/reader/${id}${params.size ? `?${params}` : ''}`);
  }, []);

  const askAbout = useCallback((text, bookId, chapterIndex) => {
    const params = new URLSearchParams();
    if (text) params.set('q', text);
    if (bookId) params.set('book', bookId);
    if (chapterIndex !== undefined) params.set('chapter', chapterIndex);
    navigate(`/ask${params.size ? `?${params}` : ''}`);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!route.path.startsWith('/library') && !route.path.startsWith('/reader')) {
          navigate('/library?focus=search');
        } else {
          document.querySelector('[data-global-search]')?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.path]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const currentBook = useMemo(() => {
    if (!data || route.parts[0] !== 'reader') return null;
    return data.books.find((book) => book.id === route.parts[1]) || null;
  }, [data, route]);

  const contextValue = useMemo(
    () => ({
      data,
      books: data?.books || [],
      maps: data?.maps || [],
      concepts: data?.concepts || [],
      threads: data?.threads || [],
      settings: data?.settings,
      stats: data?.stats,
      route,
      prefs,
      setPrefs,
      refresh,
      toast,
      importOpen,
      setImportOpen,
      openBook,
      askAbout,
    }),
    [data, route, prefs, setPrefs, refresh, toast, importOpen, openBook, askAbout],
  );

  if (!data && !error) return <BrandLoader />;
  if (!data && error) return <BrandLoader error={error} onRetry={() => { setError(''); refresh().catch(() => {}); }} />;

  let page = null;
  const root = route.parts[0] || 'library';
  if (root === 'reader' && route.parts[1]) {
    page = (
      <Reader
        key={`${route.parts[1]}:${route.query.toString()}`}
        bookId={route.parts[1]}
        book={currentBook}
      />
    );
  } else if (root === 'ask') {
    page = <Ask />;
  } else if (root === 'maps' && route.parts[1]) {
    page = <MapEditor key={route.parts[1]} mapId={route.parts[1]} />;
  } else if (root === 'maps') {
    page = <Maps />;
  } else if (root === 'concepts' && route.parts[1]) {
    page = <ConceptEditor key={route.parts[1]} conceptId={route.parts[1]} />;
  } else if (root === 'concepts') {
    page = <Concepts />;
  } else if (root === 'settings') {
    page = <Settings />;
  } else {
    page = <Library />;
  }

  return (
    <AppContext.Provider value={contextValue}>
      <div className={`app-shell ${root === 'reader' ? 'is-reader' : ''}`}>
        <Sidebar current={root} />
        <main className="app-content">{page}</main>
      </div>
      <DisplayControls />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async (book) => {
          await refresh(true).catch(() => {});
          setImportOpen(false);
          if (book?.id) openBook(book.id);
        }}
      />
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.type}`}>
            <span className="toast-dot" />
            {item.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
