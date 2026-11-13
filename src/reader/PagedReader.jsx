import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './PagedReader.css';

const MIN_PAGE_WIDTH = 64;
const MAX_PAGES = 20000;
const COLUMN_GAP_FALLBACK = 56;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function px(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 按字体大小自动分页的阅读器。
 *
 * 原理：一个固定高度的 CSS multi-column 容器，`column-width` 等于可视宽度，
 * 内容超过一页高后会在水平方向生成新的分栏；切页只需按
 * （页宽 + column-gap）的步长横向平移容器。
 *
 * 组件不访问 API，只通过 props 回调向外汇报进度。
 */
const PagedReader = forwardRef(function PagedReader(
  {
    book,
    chapter,
    chapterIndex = 0,
    chapterCount = 1,
    html = '',
    initialRatio = 0,
    onProgress,
    onPrevChapter,
    onNextChapter,
  },
  ref,
) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);

  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [metrics, setMetrics] = useState({ width: 0, gap: COLUMN_GAP_FALLBACK });
  const [animate, setAnimate] = useState(false);

  const pageRef = useRef(1);
  const pagesRef = useRef(1);
  const chapterRef = useRef(chapterIndex);
  const chapterIndexRef = useRef(chapterIndex);
  const chapterCountRef = useRef(chapterCount);
  chapterIndexRef.current = chapterIndex;
  chapterCountRef.current = chapterCount;
  const mountedRef = useRef(false);
  const reportedRef = useRef(0);
  const pendingRestoreRef = useRef(null);
  const frameRef = useRef(0);
  const measureRef = useRef(null);

  const initialRatioRef = useRef(initialRatio);
  initialRatioRef.current = initialRatio;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onPrevChapterRef = useRef(onPrevChapter);
  onPrevChapterRef.current = onPrevChapter;
  const onNextChapterRef = useRef(onNextChapter);
  onNextChapterRef.current = onNextChapter;

  const report = useCallback((nextPage, total, force = false) => {
    const ratio = total > 1 ? (nextPage - 1) / (total - 1) : 0;
    if (!force && ratio === reportedRef.current) return;
    reportedRef.current = ratio;
    onProgressRef.current?.(ratio);
  }, []);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const computed = window.getComputedStyle(track);
    const padX = px(computed.paddingLeft) + px(computed.paddingRight);
    const outerWidth = viewport.clientWidth;
    const width = outerWidth - padX;
    if (width < MIN_PAGE_WIDTH) return;
    const gap = px(computed.columnGap) || COLUMN_GAP_FALLBACK;

    // 用整数宽度布局，保证多栏步长和 translateX 的步长完全一致，
    // 否则窗口有小数宽度时，翻到最后几页会逐渐错位。
    track.style.width = `${outerWidth}px`;
    track.style.columnWidth = `${width}px`;

    // 读取 scrollWidth 会强制排版，拿到实际生成的分栏总宽度。
    const contentWidth = Math.max(0, track.scrollWidth - padX);
    const total = clamp(
      Math.round((contentWidth + gap) / (width + gap)),
      1,
      MAX_PAGES,
    );

    const oldPage = pageRef.current;
    const oldTotal = pagesRef.current;
    const restoreRatio = pendingRestoreRef.current;
    let nextPage = oldPage;

    if (restoreRatio != null) {
      nextPage = 1 + Math.round(clamp(restoreRatio, 0, 1) * (total - 1));
      pendingRestoreRef.current = null;
    } else if (oldTotal > 1 && total !== oldTotal) {
      // 字号 / 行距 / 窗口变化后，按比例落到新页，保持阅读位置。
      const ratio = (oldPage - 1) / (oldTotal - 1);
      nextPage = 1 + Math.round(ratio * (total - 1));
    }
    nextPage = clamp(nextPage, 1, total);

    pagesRef.current = total;
    pageRef.current = nextPage;
    setPages(total);
    setPage(nextPage);
    // 重新分页 / 恢复进度时直接落位，不做翻页动画。
    setAnimate(false);
    setMetrics((prev) =>
      Math.abs(prev.width - width) < 0.5 && Math.abs(prev.gap - gap) < 0.5
        ? prev
        : { width, gap },
    );

    if (restoreRatio != null) {
      report(nextPage, total, true);
      return;
    }
    if (nextPage !== oldPage || total !== oldTotal) report(nextPage, total);
  }, [report]);

  measureRef.current = measure;

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      measureRef.current?.();
    });
  }, []);

  // 章节变化时重置页码，并只在此时（以及首次挂载）消费 initialRatio。
  useLayoutEffect(() => {
    const isFirst = !mountedRef.current;
    const isChapterChange = chapterRef.current !== chapterIndex;
    chapterRef.current = chapterIndex;
    mountedRef.current = true;

    if (isFirst || isChapterChange) {
      pageRef.current = 1;
      pagesRef.current = 1;
      setPage(1);
      setPages(1);
      setAnimate(false);
      pendingRestoreRef.current = clamp(Number(initialRatioRef.current) || 0, 0, 1);
    }
    measure();
  }, [chapterIndex, html, measure]);

  // 窗口 / 父容器尺寸变化。
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scheduleMeasure]);

  // 字号、行距、版心由父级 .reader-page 上的 CSS 变量控制，尺寸不变，
  // ResizeObserver 捕捉不到，所以额外监听祖先的 style / class 变化。
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof MutationObserver === 'undefined') return undefined;
    const target = viewport.closest('.reader-page') || document.body;
    const observer = new MutationObserver(() => scheduleMeasure());
    const options = { attributes: true, attributeFilter: ['style', 'class'] };
    observer.observe(target, options);
    if (target !== document.documentElement) observer.observe(document.documentElement, options);
    return () => observer.disconnect();
  }, [scheduleMeasure]);

  // 字体加载完成后字体度量会变，需要重新分页。
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return undefined;
    const onFonts = () => scheduleMeasure();
    fonts.addEventListener?.('loadingdone', onFonts);
    fonts.ready?.then(onFonts).catch(() => {});
    return () => fonts.removeEventListener?.('loadingdone', onFonts);
  }, [scheduleMeasure]);

  // 图片未加载时高度为 0，会影响分栏结果；强制加载并在完成后重排。
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const images = Array.from(track.querySelectorAll('img'));
    if (!images.length) return undefined;
    const pending = [];
    images.forEach((image) => {
      if (image.loading === 'lazy') image.loading = 'eager';
      if (image.complete) return;
      pending.push(image);
      image.addEventListener('load', scheduleMeasure);
      image.addEventListener('error', scheduleMeasure);
    });
    return () => {
      pending.forEach((image) => {
        image.removeEventListener('load', scheduleMeasure);
        image.removeEventListener('error', scheduleMeasure);
      });
    };
  }, [html, scheduleMeasure]);

  useEffect(
    () => () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    },
    [],
  );

  const goToPage = useCallback(
    (next, notify = true) => {
      const total = pagesRef.current || 1;
      const clamped = clamp(Math.round(next), 1, total);
      if (clamped === pageRef.current) return;
      pendingRestoreRef.current = null;
      pageRef.current = clamped;
      setPage(clamped);
      setAnimate(true);
      if (notify) report(clamped, total);
    },
    [report],
  );

  const goToText = useCallback(
    (query) => {
      const track = trackRef.current;
      const needle = String(query || '').trim();
      if (!track || !needle) return false;
      const walker = document.createTreeWalker(track, NodeFilter.SHOW_TEXT);
      let node = null;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.toLowerCase().includes(needle.toLowerCase())) {
          node = walker.currentNode;
          break;
        }
      }
      if (!node) return false;
      const index = node.textContent.toLowerCase().indexOf(needle.toLowerCase());
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const rect = range.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      const stride = Math.max(1, metrics.width + metrics.gap);
      const pageIndex = Math.floor((rect.left - trackRect.left) / stride) + 1;
      goToPage(pageIndex);
      return true;
    },
    [goToPage, metrics.width, metrics.gap],
  );

  // 翻页；到达本章第一页 / 最后一页时继续翻会切到相邻章节。
  const turnPage = useCallback(
    (delta = 1) => {
      const step = Math.trunc(Number(delta) || 0);
      if (!step) return;
      const total = pagesRef.current || 1;
      const totalChapters = Math.max(1, Number(chapterCountRef.current) || 1);
      if (step > 0) {
        if (pageRef.current < total) {
          goToPage(pageRef.current + step);
        } else if (chapterIndexRef.current < totalChapters - 1) {
          onNextChapterRef.current?.();
        }
        return;
      }
      if (pageRef.current > 1) {
        goToPage(pageRef.current + step);
      } else if (chapterIndexRef.current > 0) {
        onPrevChapterRef.current?.();
      }
    },
    [goToPage],
  );

  useImperativeHandle(
    ref,
    () => ({
      turnPage,
      goToText,
      currentPage: () => pageRef.current,
      totalPages: () => pagesRef.current,
    }),
    [turnPage, goToText],
  );

  const totalChapters = Math.max(1, Number(chapterCount) || 1);
  const canPrevChapter = chapterIndex > 0;
  const canNextChapter = chapterIndex < totalChapters - 1;
  const atFirstPage = page <= 1;
  const atLastPage = page >= pages;

  const handlePrev = () => turnPage(-1);
  const handleNext = () => turnPage(1);

  const prevLabel = atFirstPage && canPrevChapter ? '上一节' : '上一页';
  const nextLabel = atLastPage && canNextChapter ? '下一节' : '下一页';
  const prevDisabled = atFirstPage && !canPrevChapter;
  const nextDisabled = atLastPage && !canNextChapter;
  const offset = (page - 1) * (metrics.width + metrics.gap);

  return (
    <div className="paged-reader">
      <div
        className="paged-reader-viewport"
        ref={viewportRef}
        role="region"
        aria-label="翻页阅读"
      >
        <div
          className={`paged-reader-track${animate ? ' is-turning' : ''}`}
          ref={trackRef}
          style={{ transform: `translateX(-${offset}px)` }}
        >
          <article className="paged-reader-article">
            <header className="article-head paged-reader-head">
              <p className="article-eyebrow">
                <span>第 {chapterIndex + 1} 节</span>
                <i />
                <span>{book?.author || '佚名'}</span>
              </p>
              <h1>{chapter?.title || '未命名章节'}</h1>
              <div className="article-meta">
                <span>{book?.title || '未命名书籍'}</span>
                <span>
                  {Math.max(1, Math.round((book?.wordCount || 0) / 400))} 分钟阅读
                </span>
                {book?.sourceType === 'wechat' ? <span>微信公众号</span> : null}
              </div>
              <div className="article-rule">
                <span />
              </div>
            </header>

            <div
              className="article-body paged-reader-body"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        </div>
      </div>

      <footer className="paged-reader-bar">
        <button
          type="button"
          className="paged-reader-btn"
          onClick={handlePrev}
          disabled={prevDisabled}
          title={prevLabel}
          aria-label={prevLabel}
        >
          <ChevronLeft size={17} aria-hidden="true" />
          <span>{prevLabel}</span>
        </button>

        <div
          className="paged-reader-count"
          aria-live="polite"
          aria-label={`第 ${page} 页，共 ${pages} 页`}
        >
          <b>{page}</b>
          <i>/</i>
          <span>{pages}</span>
        </div>

        <button
          type="button"
          className="paged-reader-btn"
          onClick={handleNext}
          disabled={nextDisabled}
          title={nextLabel}
          aria-label={nextLabel}
        >
          <span>{nextLabel}</span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
});

export default PagedReader;
