import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Expand,
  Lightbulb,
  ListTree,
  Loader2,
  Network,
  Plus,
  RefreshCcw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import './ReaderMapPanel.css';
import {
  buildSvgMarkup,
  computeLayout,
  countNodes,
} from '../mindmap/layout.js';
import { cx, navigate, truncate, relativeTime } from '../utils.js';

const TITLE_COLLAPSED_KEY = 'pagenest.reader.mapTitleCollapsed.v1';

function readTitleCollapsed() {
  try {
    return window.localStorage.getItem(TITLE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function scopeIcon(scopeType) {
  if (scopeType === 'chapter') return ListTree;
  if (scopeType === 'concept') return Lightbulb;
  return BookOpen;
}

function scopeText(map) {
  if (map.scopeLabel) return map.scopeLabel;
  if (map.scopeType === 'chapter') return '章节';
  if (map.scopeType === 'concept') return '概念';
  return '全书';
}

export default function ReaderMapPanel({ book, chapterIndex, chapterTitle, onClose }) {
  const { settings, refresh, toast } = useApp();
  const aiReady = Boolean(settings?.ai?.configured);
  const [maps, setMaps] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedMap, setSelectedMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMap, setLoadingMap] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeType, setScopeType] = useState(chapterIndex !== undefined ? 'chapter' : 'book');
  const [concept, setConcept] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [mode, setMode] = useState('local');
  const [creating, setCreating] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [titleCollapsed, setTitleCollapsed] = useState(readTitleCollapsed);
  const listRef = useRef(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(TITLE_COLLAPSED_KEY, titleCollapsed ? '1' : '0');
    } catch {
      // localStorage may be unavailable in private or restricted contexts.
    }
  }, [titleCollapsed]);

  const loadMaps = async (preferredId = null) => {
    setLoading(true);
    try {
      const list = await api.getMaps(book.id);
      setMaps(list);
      const nextId =
        (preferredId && list.some((map) => map.id === preferredId) ? preferredId : null) ||
        (selectedId && list.some((map) => map.id === selectedId) ? selectedId : null) ||
        list[0]?.id ||
        null;
      setSelectedId(nextId);
      if (nextId) {
        setLoadingMap(true);
        const full = await api.getMap(nextId);
        setSelectedMap(full);
      } else {
        setSelectedMap(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMap(false);
    }
  };

  useEffect(() => {
    setSelectedMap(null);
    setSelectedId(null);
    loadMaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    if (!listOpen) return undefined;
    const close = (event) => {
      if (!listRef.current?.contains(event.target)) setListOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [listOpen]);

  const selectMap = async (id) => {
    setSelectedId(id);
    setListOpen(false);
    setLoadingMap(true);
    setError('');
    try {
      const map = await api.getMap(id);
      setSelectedMap(map);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMap(false);
    }
  };

  const generate = async () => {
    if (creating) return;
    if (scopeType === 'chapter' && chapterIndex === undefined) {
      setError('当前阅读位置没有可用章节');
      return;
    }
    if (scopeType === 'concept' && !concept.trim()) {
      setError('请先输入要整理的概念');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await api.generateMap({
        bookId: book.id,
        scopeType,
        chapterIndex: scopeType === 'chapter' ? chapterIndex : null,
        concept: scopeType === 'concept' ? concept.trim() : '',
        title: customTitle.trim(),
        mode,
      });
      await loadMaps(result.map.id);
      setCreateOpen(false);
      setCustomTitle('');
      setConcept('');
      setMode('local');
      refresh(true).catch(() => {});
      toast(result.mode === 'ai' ? 'AI 已生成新的导图' : '已从原文生成新的导图');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const revise = async (preset) => {
    const value = (preset ?? instruction).trim();
    if (!value || revising || !selectedId) return;
    if (!aiReady) {
      setError('用指令修改导图需要先在设置中配置 AI。');
      return;
    }
    setRevising(true);
    setError('');
    try {
      const result = await api.reviseMap(selectedId, value);
      setSelectedMap(result.map);
      await refresh(true).catch(() => {});
      setInstruction('');
      toast('AI 已按指令更新导图');
      loadMaps(selectedId).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setRevising(false);
    }
  };

  const layout = useMemo(
    () => (selectedMap?.root ? computeLayout(selectedMap.root) : null),
    [selectedMap],
  );
  const svg = useMemo(
    () => (layout ? buildSvgMarkup(layout, selectedMap?.theme || 'forest') : ''),
    [layout, selectedMap?.theme],
  );

  const currentChapterLabel = chapterTitle || `第 ${chapterIndex + 1} 节`;

  return (
    <div className="reader-map-panel">
      <div className={cx('map-panel-top', titleCollapsed && 'is-collapsed')}>
        <div className="map-panel-title" id="reader-map-title" hidden={titleCollapsed}>
          <p className="eyebrow">READING MAPS</p>
          <h3>{truncate(book.title, 26)}</h3>
          <span>{maps.length} 张导图 · 按章节或概念分别保存</span>
        </div>
        <div className="map-panel-actions">
          <button
            type="button"
            className={cx('map-title-toggle', titleCollapsed && 'is-collapsed')}
            onClick={() => setTitleCollapsed((value) => !value)}
            aria-expanded={!titleCollapsed}
            aria-controls="reader-map-title"
            aria-label={titleCollapsed ? '展开 READING MAPS 标题区' : '收起 READING MAPS 标题区'}
            title={titleCollapsed ? '展开 READING MAPS 标题区' : '收起 READING MAPS 标题区'}
          >
            {titleCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {titleCollapsed ? <span>READING MAPS</span> : null}
          </button>
          <button
            type="button"
            className="map-new-btn"
            onClick={() => { setCreateOpen((value) => !value); setError(''); }}
          >
            <Plus size={15} /> 新建
          </button>
        </div>
      </div>

      {createOpen ? (
        <div className="map-create-panel">
          <div className="map-create-head">
            <strong>新建一张导图</strong>
            <button type="button" className="icon-btn tiny" onClick={() => setCreateOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="map-scope-options">
            <button
              type="button"
              className={cx(scopeType === 'chapter' && 'is-active')}
              onClick={() => setScopeType('chapter')}
            >
              <ListTree size={14} /> 当前{chapterIndex !== undefined ? '章节' : '位置'}
            </button>
            <button
              type="button"
              className={cx(scopeType === 'book' && 'is-active')}
              onClick={() => setScopeType('book')}
            >
              <BookOpen size={14} /> 整本书
            </button>
            <button
              type="button"
              className={cx(scopeType === 'concept' && 'is-active')}
              onClick={() => setScopeType('concept')}
            >
              <Lightbulb size={14} /> 一个概念
            </button>
          </div>
          {scopeType === 'chapter' ? (
            <p className="map-scope-note"><ListTree size={12} /> 只读取：{truncate(currentChapterLabel, 30)}</p>
          ) : null}
          {scopeType === 'concept' ? (
            <input
              value={concept}
              onChange={(event) => setConcept(event.target.value)}
              placeholder="例如：注意力经济、复利、刻意练习"
              className="map-concept-input"
            />
          ) : null}
          <input
            value={customTitle}
            onChange={(event) => setCustomTitle(event.target.value)}
            placeholder="导图名称（可选，留空自动命名）"
            className="map-title-input"
          />
          <div className="map-create-mode">
            <button
              type="button"
              className={cx(mode === 'local' && 'is-active')}
              onClick={() => setMode('local')}
            >
              本地提取
            </button>
            <button
              type="button"
              className={cx(mode === 'ai' && 'is-active')}
              onClick={() => aiReady && setMode('ai')}
              disabled={!aiReady}
              title={aiReady ? '' : '需要配置 AI'}
            >
              <Sparkles size={12} /> AI 提炼 {aiReady ? '' : '（未配置）'}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm map-generate-btn"
            onClick={generate}
            disabled={creating}
          >
            {creating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
            {creating ? '正在阅读与整理…' : '生成这张导图'}
          </button>
        </div>
      ) : null}

      {maps.length ? (
        <div className="map-selector" ref={listRef}>
          <button
            type="button"
            className="map-selector-current"
            onClick={() => setListOpen((value) => !value)}
          >
            <span className="map-selector-icon">
              {selectedMap ? (() => {
                const Icon = scopeIcon(selectedMap.scopeType);
                return <Icon size={14} />;
              })() : <Network size={14} />}
            </span>
            <span>
              <strong>{selectedMap?.title || '选择一张导图'}</strong>
              <small>
                {selectedMap
                  ? `${scopeText(selectedMap)} · ${countNodes(selectedMap.root)} 个节点`
                  : '加载中…'}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
          {listOpen ? (
            <div className="map-selector-menu">
              {maps.map((map) => {
                const Icon = scopeIcon(map.scopeType);
                return (
                  <button
                    key={map.id}
                    type="button"
                    className={cx(map.id === selectedId && 'is-active')}
                    onClick={() => selectMap(map.id)}
                  >
                    <Icon size={13} />
                    <span>
                      <strong>{map.title}</strong>
                      <small>{scopeText(map)} · {map.nodeCount} 节点 · {relativeTime(map.updatedAt)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="map-panel-scroll">
        {loading || loadingMap ? (
          <div className="map-panel-loading">
            <Loader2 size={20} className="spin" />
            <span>正在铺开导图…</span>
          </div>
        ) : selectedMap ? (
          <>
            <div className="map-preview-card">
              <div className="map-preview-head">
                <div>
                  <span className="map-preview-scope">{scopeText(selectedMap)}</span>
                  <h4>{selectedMap.title}</h4>
                </div>
                <button
                  type="button"
                  className="map-expand-btn"
                  onClick={() => navigate(`/maps/${selectedMap.id}`)}
                  title="在完整画布中编辑"
                >
                  <Expand size={14} /> 编辑
                </button>
              </div>
              <div
                className="dock-map-preview"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <p className="map-preview-foot">
                {countNodes(selectedMap.root)} 个节点 · {relativeTime(selectedMap.updatedAt)}
              </p>
            </div>

            <div className="map-revise-card">
              <div className="map-revise-head">
                <span><Sparkles size={14} /> 让 AI 继续改这张图</span>
                {!aiReady ? <em>需配置 AI</em> : null}
              </div>
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={aiReady ? '例如：精简为 3 个主分支；补充本节的例子；把每个节点压到 12 字以内…' : '先在设置中配置 AI，才能用自然语言修改导图。'}
                rows={2}
                disabled={!aiReady || revising}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    revise();
                  }
                }}
              />
              <div className="map-revise-quick">
                {['精简为 3 个主分支', '补充本节例子', '每个节点不超过 12 字'].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setInstruction(item)}
                    disabled={!aiReady || revising}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm map-revise-btn"
                onClick={() => revise()}
                disabled={!aiReady || revising || !instruction.trim()}
              >
                {revising ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                {revising ? 'AI 正在改图…' : '按指令修改'}
              </button>
            </div>
          </>
        ) : (
          <div className="map-panel-empty">
            <span><Network size={24} /></span>
            <h3>这本书还没有自己的导图</h3>
            <p>可以从当前章节、整本书或一个概念开始，同一本书可以保存很多张。</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> 生成第一张
            </button>
          </div>
        )}
        {error ? (
          <div className="map-panel-error">
            <span>{error}</span>
            {error.includes('AI') || error.includes('配置') ? (
              <button type="button" onClick={() => navigate('/settings')}>去设置</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
