import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { clamp } from '../utils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

function highlightTextLayer(container, query) {
  if (!container) return null;
  container.querySelectorAll('span.is-match').forEach((span) => span.classList.remove('is-match'));
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  let first = null;
  container.querySelectorAll('span').forEach((span) => {
    if (!span.textContent?.toLowerCase().includes(needle)) return;
    span.classList.add('is-match');
    if (!first) first = span;
  });
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return first;
}

async function buildOutline(pdf) {
  let raw = null;
  try {
    raw = await pdf.getOutline();
  } catch {
    return [];
  }
  if (!raw?.length) return [];
  const cache = new Map();
  async function resolvePage(dest) {
    try {
      let explicit = dest;
      if (typeof explicit === 'string') {
        if (cache.has(explicit)) return cache.get(explicit);
        explicit = await pdf.getDestination(explicit);
      }
      if (!Array.isArray(explicit) || !explicit[0]) return null;
      const index = await pdf.getPageIndex(explicit[0]);
      return index + 1;
    } catch {
      return null;
    }
  }
  async function walk(items, depth = 0) {
    const out = [];
    for (const item of items.slice(0, 40)) {
      const page = await resolvePage(item.dest);
      const children = item.items?.length ? await walk(item.items, depth + 1) : [];
      out.push({
        title: String(item.title || '').trim().slice(0, 90) || `第 ${page || 1} 页`,
        page: page || 1,
        children,
      });
    }
    return out;
  }
  return walk(raw);
}

const PdfPage = forwardRef(function PdfPage(
  { pdf, pageNumber, scale, pageRatio, baseWidth, register, highlightRequest },
  ref,
) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [dims, setDims] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [textReady, setTextReady] = useState(false);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setVisible(entry.isIntersecting);
      },
      { root: element.closest('.pdf-stage'), rootMargin: '1400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible) return;
    if (textRef.current) textRef.current.innerHTML = '';
    setTextReady(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    let renderTask = null;
    setRendering(true);
    setTextReady(false);
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        setDims({ width: viewport.width, height: viewport.height });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
          background: '#ffffff',
        });
        await renderTask.promise;
        if (cancelled) return;

        const content = await page.getTextContent();
        if (cancelled) return;
        const layer = textRef.current;
        if (!layer) return;
        layer.innerHTML = '';
        layer.style.width = `${viewport.width}px`;
        layer.style.height = `${viewport.height}px`;
        const fragment = document.createDocumentFragment();
        for (const item of content.items) {
          if (!item.str) continue;
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const span = document.createElement('span');
          span.textContent = item.str;
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontHeight}px`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = '"Microsoft YaHei", "PingFang SC", sans-serif';
          span.style.transformOrigin = '0 0';
          fragment.appendChild(span);
        }
        layer.appendChild(fragment);
        setTextReady(true);
        register?.(pageNumber, {
          highlight: (q) => highlightTextLayer(layer, q),
          element: wrapRef.current,
        });
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          console.warn('PDF page render failed', pageNumber, err);
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // 忽略取消错误
      }
    };
  }, [visible, scale, pdf, pageNumber, register]);

  useEffect(() => {
    if (!highlightRequest || highlightRequest.page !== pageNumber || !textReady) return;
    const timer = setTimeout(() => {
      highlightTextLayer(textRef.current, highlightRequest.q);
    }, 160);
    return () => clearTimeout(timer);
  }, [highlightRequest, pageNumber, textReady]);

  const estimatedWidth = baseWidth ? baseWidth * scale : null;
  const placeholderHeight = dims?.height || (estimatedWidth || 920) * pageRatio;
  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      ref={(node) => {
        wrapRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      style={{
        width: dims?.width
          ? `${dims.width}px`
          : estimatedWidth
            ? `${estimatedWidth}px`
            : 'min(100%, 820px)',
        minHeight: `${placeholderHeight}px`,
      }}
    >
      {visible ? <canvas ref={canvasRef} className="pdf-canvas" /> : null}
      {!visible || rendering ? (
        <div className="pdf-page-loading">
          <Loader2 size={20} className="spin" />
          <span>第 {pageNumber} 页</span>
        </div>
      ) : null}
      <div className="pdf-text-layer" ref={textRef} />
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  );
});

const PdfViewer = forwardRef(function PdfViewer(
  { bookId, initialPage = 1, onPageChange, onOutline },
  ref,
) {
  const stageRef = useRef(null);
  const pageApis = useRef(new Map());
  const [pdf, setPdf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [pageRatio, setPageRatio] = useState(1.414);
  const [baseWidth, setBaseWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [highlightRequest, setHighlightRequest] = useState(null);
  const currentPageRef = useRef(initialPage);
  const scaleRef = useRef(1);
  const pageChangeRef = useRef(onPageChange);
  const outlineRef = useRef(onOutline);
  const initialPageRef = useRef(initialPage);
  const didInit = useRef(false);
  const scrollRaf = useRef(0);
  const lastReport = useRef({ page: 0, ratio: 0 });

  pageChangeRef.current = onPageChange;
  outlineRef.current = onOutline;
  scaleRef.current = scale;

  const reportPage = useCallback((page, ratio) => {
    const rounded = Math.round(ratio * 100) / 100;
    if (lastReport.current.page === page && Math.abs(lastReport.current.ratio - rounded) < 0.015) return;
    lastReport.current = { page, ratio: rounded };
    pageChangeRef.current?.(page, rounded);
  }, []);

  const scrollToPage = useCallback((page, smooth = true) => {
    const stage = stageRef.current;
    if (!stage) return;
    const target = stage.querySelector(`[data-page="${page}"]`);
    if (!target) return;
    const stageRect = stage.getBoundingClientRect();
    const top = target.getBoundingClientRect().top - stageRect.top + stage.scrollTop - 18;
    stage.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    currentPageRef.current = page;
    setCurrentPage(page);
    setPageInput(String(page));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(page) {
        const next = clamp(Number(page) || 1, 1, totalPages || 9999);
        scrollToPage(next, true);
      },
      highlightQuery(page, q) {
        if (!q?.trim()) return;
        setHighlightRequest({ page: Number(page) || 1, q: q.trim(), nonce: Date.now() });
      },
      currentPage: () => currentPageRef.current,
    }),
    [scrollToPage, totalPages],
  );

  useEffect(() => {
    let alive = true;
    let doc = null;
    setLoading(true);
    setError('');
    const task = pdfjsLib.getDocument({
      url: `/api/books/${bookId}/file`,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      isEvalSupported: false,
    });
    task.promise
      .then(async (loaded) => {
        if (!alive) {
          loaded.destroy();
          return;
        }
        doc = loaded;
        setPdf(loaded);
        setTotalPages(loaded.numPages);
        const first = await loaded.getPage(1);
        if (!alive) return;
        const viewport = first.getViewport({ scale: 1 });
        setPageRatio(viewport.height / viewport.width);
        setBaseWidth(viewport.width);
        setLoading(false);
        currentPageRef.current = clamp(initialPageRef.current, 1, loaded.numPages);
        const targetPage = currentPageRef.current;
        setCurrentPage(currentPageRef.current);
        setPageInput(String(currentPageRef.current));
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const stageWidth = stageRef.current?.clientWidth || 900;
            const fit = clamp((stageWidth - 72) / viewport.width, 0.55, 2.1);
            setScale(fit);
            scaleRef.current = fit;
            setTimeout(() => {
              scrollToPage(targetPage, false);
              reportPage(targetPage, 0);
            }, 140);
            setTimeout(() => scrollToPage(targetPage, false), 720);
          });
        });

        buildOutline(loaded)
          .then((outline) => {
            if (alive) outlineRef.current?.(outline, loaded.numPages);
          })
          .catch(() => {});
      })
      .catch((err) => {
        if (!alive) return;
        console.error(err);
        setError(
          err?.message?.includes('Missing PDF')
            ? '无法读取 PDF 文件，原始文件可能已丢失。'
            : `PDF 加载失败：${err?.message || '未知错误'}`,
        );
        setLoading(false);
      });
    return () => {
      alive = false;
      try {
        task.destroy();
      } catch {
        // 忽略
      }
      if (doc) doc.destroy().catch(() => {});
    };
  }, [bookId, reportPage, scrollToPage]);

  const handleScroll = () => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const stage = stageRef.current;
      if (!stage) return;
      const pages = stage.querySelectorAll('.pdf-page');
      if (!pages.length) return;
      const stageRect = stage.getBoundingClientRect();
      let active = pages[0];
      let bestVisible = -1;
      for (const page of pages) {
        const rect = page.getBoundingClientRect();
        const visible =
          Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top);
        if (visible > bestVisible) {
          bestVisible = visible;
          active = page;
        }
      }
      const pageNumber = Number(active.dataset.page) || 1;
      const activeRect = active.getBoundingClientRect();
      const local = clamp((stageRect.top + 160 - activeRect.top) / Math.max(1, activeRect.height), 0, 1);
      if (pageNumber !== currentPageRef.current) {
        currentPageRef.current = pageNumber;
        setCurrentPage(pageNumber);
        setPageInput(String(pageNumber));
      }
      reportPage(pageNumber, local);
    });
  };

  const zoomBy = (delta) => {
    const next = clamp(scaleRef.current + delta, 0.4, 3.2);
    setScale(next);
    scaleRef.current = next;
    requestAnimationFrame(() => scrollToPage(currentPageRef.current, false));
  };

  const fitWidth = () => {
    if (!pdf) return;
    pdf.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      const width = stageRef.current?.clientWidth || 900;
      const next = clamp((width - 72) / viewport.width, 0.4, 3.2);
      setScale(next);
      scaleRef.current = next;
      requestAnimationFrame(() => scrollToPage(currentPageRef.current, false));
    });
  };

  const jump = (target) => {
    const page = clamp(Number(target) || 1, 1, totalPages || 1);
    scrollToPage(page, true);
  };

  const registerPage = useCallback((page, api) => {
    pageApis.current.set(page, api);
  }, []);

  if (loading) {
    return (
      <div className="pdf-loading">
        <span className="reader-loader"><Loader2 size={22} className="spin" /></span>
        <p>正在载入 PDF…</p>
        <small>大文件第一次打开会多花一点时间</small>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-error">
        <h3>PDF 没能打开</h3>
        <p>{error}</p>
        <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
          <RotateCcw size={15} /> 重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="pdf-shell">
      <div className="pdf-stage" ref={stageRef} onScroll={handleScroll}>
        <div className="pdf-pages">
          {Array.from({ length: totalPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              pageNumber={index + 1}
              scale={scale}
              pageRatio={pageRatio}
              register={registerPage}
              highlightRequest={highlightRequest}
            />
          ))}
        </div>
      </div>
      <div className="pdf-controls">
        <div className="pdf-control-group">
          <button
            type="button"
            className="pdf-control-btn"
            onClick={() => jump(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="上一页"
          >
            <ChevronLeft size={17} />
          </button>
          <input
            className="pdf-page-input"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => jump(pageInput)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') jump(pageInput);
            }}
            aria-label="页码"
          />
          <span className="pdf-page-total">/ {totalPages}</span>
          <button
            type="button"
            className="pdf-control-btn"
            onClick={() => jump(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="下一页"
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <span className="pdf-control-divider" />
        <div className="pdf-control-group">
          <button type="button" className="pdf-control-btn" onClick={() => zoomBy(-0.12)} aria-label="缩小">
            <Minus size={16} />
          </button>
          <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
          <button type="button" className="pdf-control-btn" onClick={() => zoomBy(0.12)} aria-label="放大">
            <Plus size={16} />
          </button>
          <button type="button" className="pdf-control-btn" onClick={fitWidth} title="适合宽度">
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default PdfViewer;
