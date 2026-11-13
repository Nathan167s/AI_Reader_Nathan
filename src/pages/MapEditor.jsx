import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileJson,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import {
  MAP_THEMES,
  clamp,
  cx,
  downloadBlob,
  downloadText,
  navigate,
  safeFilename,
  truncate,
} from '../utils.js';
import {
  buildSvgMarkup,
  cloneTree,
  computeLayout,
  countNodes,
  markdownFromTree,
  resolveNodePalette,
} from '../mindmap/layout.js';
import {
  ensureNodeIds,
  findNode,
  findParent,
  insertChild,
  insertSibling,
  makeNode,
  moveNode,
  removeNode,
  updateNode,
} from '../mindmap/tree.js';

function MapLoading() {
  return (
    <div className="reader-fatal">
      <span className="reader-loader"><Loader2 size={22} className="spin" /></span>
      <p>正在铺开画布…</p>
    </div>
  );
}

export default function MapEditor({ mapId }) {
  const { toast } = useApp();
  const [map, setMap] = useState(null);
  const [root, setRoot] = useState(null);
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState('forest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const viewRef = useRef(null);
  const stageRef = useRef(null);
  const rootRef = useRef(null);
  const titleRef = useRef('');
  const themeRef = useRef('forest');
  const dirtyRef = useRef(false);
  const transformRef = useRef(transform);
  const panRef = useRef(null);
  const didFit = useRef(false);
  const versionRef = useRef(0);

  rootRef.current = root;
  titleRef.current = title;
  themeRef.current = theme;
  dirtyRef.current = dirty;
  transformRef.current = transform;

  const selectedNode = useMemo(
    () => (root ? findNode(root, selectedId) || root : null),
    [root, selectedId],
  );
  const layout = useMemo(() => (root ? computeLayout(root) : null), [root]);
  const nodeCount = useMemo(() => (root ? countNodes(root) : 0), [root]);
  const activeTheme = MAP_THEMES[theme] || MAP_THEMES.forest;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMap(mapId)
      .then((data) => {
        if (!alive) return;
        const nextRoot = ensureNodeIds(data.root);
        setMap(data);
        setRoot(nextRoot);
        rootRef.current = nextRoot;
        setTitle(data.title);
        titleRef.current = data.title;
        setTheme(data.theme || 'forest');
        themeRef.current = data.theme || 'forest';
        setSelectedId(nextRoot.id);
        setNoteDraft(nextRoot.note || '');
        setLoading(false);
        didFit.current = false;
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mapId]);

  useEffect(() => {
    const element = viewRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading]);

  const applyTransform = useCallback((next) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  const fitView = useCallback(() => {
    if (!layout || !viewport.width || !viewport.height) return;
    const scale = clamp(
      Math.min((viewport.width - 120) / layout.width, (viewport.height - 120) / layout.height),
      0.55,
      1.35,
    );
    applyTransform({
      x: (viewport.width - layout.width * scale) / 2,
      y: (viewport.height - layout.height * scale) / 2,
      scale,
    });
  }, [layout, viewport, applyTransform]);

  useEffect(() => {
    if (!layout || !viewport.width || didFit.current) return;
    fitView();
    didFit.current = true;
  }, [layout, viewport, fitView]);

  useEffect(() => {
    if (!selectedId && root) setSelectedId(root.id);
    if (root && selectedId && !findNode(root, selectedId)) {
      setSelectedId(root.id);
      setNoteDraft(root.note || '');
    }
  }, [root, selectedId]);

  useEffect(() => {
    setNoteDraft(selectedNode?.note || '');
  }, [selectedNode?.id]);

  useEffect(() => {
    const element = viewRef.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      if (event.target.closest('.mm-inspector, .mm-toolbar, .mm-topbar, .mm-hint')) return;
      event.preventDefault();
      const current = transformRef.current;
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0013);
      const scale = clamp(current.scale * factor, 0.3, 2.4);
      const next = {
        scale,
        x: px - (px - current.x) * (scale / current.scale),
        y: py - (py - current.y) * (scale / current.scale),
      };
      applyTransform(next);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [applyTransform]);

  const saveNow = useCallback(async () => {
    if (!map || !rootRef.current) return;
    const version = versionRef.current;
    setSaveState('saving');
    try {
      const saved = await api.updateMap(map.id, {
        title: titleRef.current,
        root: rootRef.current,
        theme: themeRef.current,
      });
      setMap((current) => (current ? { ...current, ...saved } : current));
      if (version === versionRef.current) {
        setDirty(false);
        dirtyRef.current = false;
        setSaveState('saved');
      }
    } catch (err) {
      setSaveState('error');
      toast(`保存失败：${err.message}`, 'error');
    }
  }, [map, toast]);

  useEffect(() => {
    if (!dirty || !map) return undefined;
    const timer = setTimeout(() => saveNow(), 780);
    return () => clearTimeout(timer);
  }, [dirty, root, title, theme, map, saveNow]);

  useEffect(() => {
    const id = map?.id;
    return () => {
      if (!id || !dirtyRef.current) return;
      try {
        fetch(`/api/maps/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titleRef.current,
            root: rootRef.current,
            theme: themeRef.current,
          }),
          keepalive: true,
        });
      } catch {
        // 尽力保存
      }
    };
  }, [map?.id]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const markDirty = useCallback(() => {
    versionRef.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaveState('saving');
  }, []);

  const commit = useCallback(
    (nextRoot, { history: withHistory = true } = {}) => {
      if (!nextRoot || !rootRef.current) return;
      if (JSON.stringify(nextRoot) === JSON.stringify(rootRef.current)) return;
      if (withHistory) {
        setHistory((current) => [...current.slice(-49), cloneTree(rootRef.current)]);
        setFuture([]);
      }
      rootRef.current = nextRoot;
      setRoot(nextRoot);
      markDirty();
    },
    [markDirty],
  );

  const undo = useCallback(() => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    const current = cloneTree(rootRef.current);
    setHistory(history.slice(0, -1));
    setFuture((next) => [current, ...next].slice(0, 50));
    rootRef.current = previous;
    setRoot(previous);
    markDirty();
  }, [history, markDirty]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    const current = cloneTree(rootRef.current);
    setHistory((previous) => [...previous.slice(-49), current]);
    setFuture(future.slice(1));
    rootRef.current = next;
    setRoot(next);
    markDirty();
  }, [future, markDirty]);

  const startEditing = useCallback((node) => {
    setSelectedId(node.id);
    setEditingId(node.id);
    setEditingValue(node.text);
    setTimeout(() => {
      const editor = document.querySelector('.mm-node-editor');
      editor?.focus();
      editor?.select();
    }, 30);
  }, []);

  const selectNode = (node) => {
    if (editingId && editingId !== node.id) commitEditing();
    setSelectedId(node.id);
    setNoteDraft(node.note || '');
  };

  const addChild = useCallback(() => {
    if (!rootRef.current) return;
    const parentId = selectedId || rootRef.current.id;
    const node = makeNode('新想法');
    const next = insertChild(rootRef.current, parentId, node);
    commit(next);
    setSelectedId(node.id);
    setNoteDraft('');
    startEditing(node);
  }, [selectedId, commit, startEditing]);

  const addSibling = useCallback(() => {
    if (!rootRef.current) return;
    if (!selectedId || selectedId === rootRef.current.id) {
      toast('中心主题没有同级节点，可以添加子节点');
      return;
    }
    const node = makeNode('新想法');
    const next = insertSibling(rootRef.current, selectedId, node);
    commit(next);
    setSelectedId(node.id);
    setNoteDraft('');
    startEditing(node);
  }, [selectedId, commit, startEditing, toast]);

  const deleteSelected = useCallback(() => {
    if (!rootRef.current || !selectedId) return;
    if (selectedId === rootRef.current.id) {
      toast('中心主题不能删除');
      return;
    }
    const parent = findParent(rootRef.current, selectedId);
    const result = removeNode(rootRef.current, selectedId);
    if (!result.removed) return;
    commit(result.root);
    setSelectedId(parent?.id || rootRef.current.id);
    setEditingId(null);
    setNoteDraft(parent?.note || '');
    toast('节点已删除');
  }, [selectedId, commit, toast]);

  function commitEditing() {
    const node = rootRef.current ? findNode(rootRef.current, editingId) : null;
    if (!node) {
      setEditingId(null);
      return;
    }
    const value = editingValue.trim();
    setEditingId(null);
    if (!value) {
      if (node.id === rootRef.current.id) return;
      const parent = findParent(rootRef.current, node.id);
      const result = removeNode(rootRef.current, node.id);
      if (result.removed) {
        commit(result.root);
        setSelectedId(parent?.id || rootRef.current.id);
      }
      return;
    }
    if (value !== node.text) {
      commit(updateNode(rootRef.current, node.id, { text: value }));
    }
  }

  const setNodeNote = (value) => {
    setNoteDraft(value);
  };

  const saveNote = () => {
    if (!rootRef.current || !selectedNode) return;
    if ((selectedNode.note || '') === noteDraft) return;
    commit(updateNode(rootRef.current, selectedNode.id, { note: noteDraft.trim() }));
  };

  const moveSelected = (delta) => {
    if (!rootRef.current || !selectedId) return;
    const next = moveNode(rootRef.current, selectedId, delta);
    commit(next);
  };

  const changeTheme = (value) => {
    setTheme(value);
    themeRef.current = value;
    markDirty();
  };

  const changeTitle = (value) => {
    setTitle(value);
    markDirty();
  };

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveNow();
        return;
      }
      if (editing || editingId) return;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (target?.closest?.('button, input, textarea, select, a, [role="button"], .mm-node, .mm-toolbar')) {
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        addChild();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        addSibling();
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        if (selectedNode) startEditing(selectedNode);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key === 'Escape') {
        setSelectedId(rootRef.current?.id || null);
        setExportOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addChild, addSibling, deleteSelected, editingId, redo, saveNow, selectedNode, startEditing, undo]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const close = (event) => {
      if (!event.target.closest('.mm-export-wrap')) setExportOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [exportOpen]);

  const zoomAt = (factor, px, py) => {
    const current = transformRef.current;
    const scale = clamp(current.scale * factor, 0.3, 2.4);
    const x = px - (px - current.x) * (scale / current.scale);
    const y = py - (py - current.y) * (scale / current.scale);
    applyTransform({ x, y, scale });
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.mm-node, .mm-toolbar, .mm-inspector, .mm-topbar')) return;
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: transformRef.current,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!panRef.current) return;
    const { startX, startY, origin } = panRef.current;
    applyTransform({
      ...origin,
      x: origin.x + event.clientX - startX,
      y: origin.y + event.clientY - startY,
    });
  };

  const endPan = (event) => {
    if (!panRef.current) return;
    panRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // 忽略
    }
  };

  const exportPng = () => {
    if (!layout) return;
    const svg = buildSvgMarkup(layout, theme);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const ratio = 2;
      const canvas = document.createElement('canvas');
      canvas.width = layout.width * ratio;
      canvas.height = layout.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.fillStyle = activeTheme.paper;
      ctx.fillRect(0, 0, layout.width, layout.height);
      ctx.drawImage(image, 0, 0, layout.width, layout.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((output) => {
        if (output) downloadBlob(output, `${safeFilename(title)}.png`);
        toast('PNG 已导出');
      }, 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      toast('图片导出失败，请尝试 SVG', 'error');
    };
    image.src = url;
    setExportOpen(false);
  };

  const exportSvg = () => {
    if (!layout) return;
    downloadText(buildSvgMarkup(layout, theme), `${safeFilename(title)}.svg`, 'image/svg+xml;charset=utf-8');
    setExportOpen(false);
    toast('SVG 已导出');
  };

  const exportMarkdown = () => {
    if (!root) return;
    downloadText(markdownFromTree(root, title), `${safeFilename(title)}.md`, 'text/markdown;charset=utf-8');
    setExportOpen(false);
    toast('Markdown 已导出');
  };

  const exportJson = () => {
    if (!map || !root) return;
    downloadText(
      JSON.stringify({ ...map, title, theme, root, updatedAt: new Date().toISOString() }, null, 2),
      `${safeFilename(title)}.json`,
      'application/json;charset=utf-8',
    );
    setExportOpen(false);
    toast('JSON 已导出');
  };

  const goBack = async () => {
    await saveNow();
    navigate('/maps');
  };

  const deleteMap = async () => {
    if (!map) return;
    setDeleting(true);
    try {
      await api.deleteMap(map.id);
      toast('思维导图已删除');
      navigate('/maps');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <MapLoading />;
  if (error) {
    return (
      <div className="reader-fatal">
        <h2>没能打开这张导图</h2>
        <p>{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/maps')}>返回导图列表</button>
      </div>
    );
  }
  if (!layout || !root) return null;

  return (
    <div className="mm-page" style={{ '--map-paper': activeTheme.paper }}>
      <header className="mm-topbar">
        <div className="mm-top-left">
          <button type="button" className="reader-icon-btn" onClick={goBack} title="返回导图列表">
            <ArrowLeft size={19} />
          </button>
          <div className="mm-title-wrap">
            <input
              className="mm-title-input"
              value={title}
              onChange={(event) => changeTitle(event.target.value)}
              aria-label="导图标题"
            />
            <span className="mm-subtitle">
              {map.bookId && map.bookTitle ? (
                <button type="button" className="mm-book-link" onClick={() => navigate('/library')}>
                  <GitBranch size={11} /> 来自《{truncate(map.bookTitle, 22)}》
                </button>
              ) : map.bookTitle ? (
                <span className="mm-book-source">
                  <GitBranch size={11} /> 原书《{truncate(map.bookTitle, 20)}》已移出书架
                </span>
              ) : (
                '独立画布'
              )}
              <i />
              <span>{nodeCount} 个节点</span>
            </span>
          </div>
        </div>
        <div className="mm-top-actions">
          <span className={cx('save-state', saveState === 'error' && 'is-error')}>
            {saveState === 'saving' ? <Loader2 size={12} className="spin" /> : saveState === 'saved' ? <Check size={12} /> : <Save size={12} />}
            {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : '未保存'}
          </span>
          <div className="mm-top-divider" />
          <button type="button" className="reader-icon-btn" onClick={undo} disabled={!history.length} title="撤销 Ctrl+Z">
            <Undo2 size={17} />
          </button>
          <button type="button" className="reader-icon-btn" onClick={redo} disabled={!future.length} title="重做 Ctrl+Shift+Z">
            <Redo2 size={17} />
          </button>
          <div className="mm-export-wrap">
            <button type="button" className={cx('btn btn-ghost btn-sm', exportOpen && 'is-active')} onClick={() => setExportOpen((value) => !value)}>
              <Download size={15} /> 导出 <ChevronDown size={13} />
            </button>
            {exportOpen ? (
              <div className="mm-export-menu">
                <button type="button" onClick={exportPng}><ImageIcon size={15} /> PNG 图片</button>
                <button type="button" onClick={exportSvg}><Maximize2 size={15} /> SVG 矢量图</button>
                <button type="button" onClick={exportMarkdown}><FileText size={15} /> Markdown 大纲</button>
                <button type="button" onClick={exportJson}><FileJson size={15} /> JSON 数据</button>
              </div>
            ) : null}
          </div>
          <button type="button" className="reader-icon-btn danger-hover" onClick={() => setDeleteOpen(true)} title="删除导图">
            <Trash2 size={17} />
          </button>
        </div>
      </header>

      <div
        className={cx('mm-viewport', dragging && 'is-panning')}
        ref={viewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={(event) => {
          if (!event.target.closest('.mm-node')) fitView();
        }}
      >
        <div className="mm-canvas-bg" />
        <div
          className="mm-stage"
          ref={stageRef}
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <svg className="mm-connectors" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.connectors.map((connector) => (
              <path
                key={connector.id}
                d={connector.path}
                fill="none"
                stroke={activeTheme.branch[connector.branchIndex % 4] || activeTheme.line}
                strokeOpacity=".58"
                strokeWidth="2"
              />
            ))}
          </svg>
          {layout.nodes.map((node) => {
            const palette = resolveNodePalette(theme, node.branchIndex, node.depth);
            const isSelected = node.id === selectedNode?.id;
            const isEditing = node.id === editingId;
            return (
              <div
                key={node.id}
                className={cx(
                  'mm-node',
                  `depth-${node.depth}`,
                  isSelected && 'is-selected',
                  isEditing && 'is-editing',
                )}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                  '--node-fill': palette.fill,
                  '--node-ink': palette.ink,
                  '--node-branch': palette.branch,
                  '--node-root': palette.root,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (isEditing) return;
                  const targetNode = findNode(root, node.id);
                  if (targetNode) selectNode(targetNode);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  const targetNode = findNode(root, node.id);
                  if (targetNode) startEditing(targetNode);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    const targetNode = findNode(root, node.id);
                    if (targetNode) startEditing(targetNode);
                  }
                }}
              >
                {isEditing ? (
                  <textarea
                    className="mm-node-editor"
                    value={editingValue}
                    onChange={(event) => setEditingValue(event.target.value)}
                    onBlur={commitEditing}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        commitEditing();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <span className="mm-node-text">{node.text}</span>
                )}
                {node.note ? <span className="mm-node-note" title="有备注" /> : null}
                {isSelected && !isEditing ? (
                  <button
                    type="button"
                    className="mm-node-add"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      addChild();
                    }}
                    title="添加子节点 (Tab)"
                  >
                    <Plus size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mm-hint">
          拖动空白处平移 · 滚轮缩放 · 双击节点编辑 · Tab 子节点 · Enter 同级
        </div>

        <div className="mm-toolbar" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={addChild} title="添加子节点 (Tab)">
            <Plus size={17} />
          </button>
          <button type="button" onClick={addSibling} title="添加同级节点 (Enter)">
            <GitBranch size={16} />
          </button>
          <button type="button" onClick={deleteSelected} title="删除节点 (Delete)" disabled={selectedNode?.id === root.id}>
            <Trash2 size={16} />
          </button>
          <span className="mm-toolbar-divider" />
          <button type="button" onClick={() => zoomAt(0.88, viewport.width / 2, viewport.height / 2)} title="缩小">
            <Minus size={16} />
          </button>
          <span className="mm-zoom-value">{Math.round(transform.scale * 100)}%</span>
          <button type="button" onClick={() => zoomAt(1.14, viewport.width / 2, viewport.height / 2)} title="放大">
            <Plus size={16} />
          </button>
          <span className="mm-toolbar-divider" />
          <button type="button" onClick={fitView} title="适应画布">
            <Maximize2 size={16} />
          </button>
          <span className="mm-toolbar-divider" />
          <div className="mm-theme-row">
            {Object.entries(MAP_THEMES).map(([id, item]) => (
              <button
                key={id}
                type="button"
                className={cx('mm-theme-swatch', theme === id && 'is-active')}
                style={{ '--swatch': item.accent }}
                onClick={() => changeTheme(id)}
                title={item.name}
                aria-label={item.name}
              />
            ))}
          </div>
        </div>

        {selectedNode ? (
          <aside className="mm-inspector" onPointerDown={(event) => event.stopPropagation()}>
            <div className="mm-inspector-head">
              <div>
                <p className="eyebrow">NODE</p>
                <h3>{selectedNode.id === root.id ? '中心主题' : '选中节点'}</h3>
              </div>
              <button type="button" className="icon-btn tiny" onClick={() => startEditing(selectedNode)} title="编辑文字">
                <FileText size={14} />
              </button>
            </div>
            <p className="mm-selected-text">{selectedNode.text}</p>
            <label className="mm-note-label" htmlFor="mm-note">备注</label>
            <textarea
              id="mm-note"
              className="mm-note"
              value={noteDraft}
              onChange={(event) => setNodeNote(event.target.value)}
              onBlur={saveNote}
              placeholder="记下这个节点的解释、例子或疑问…"
              rows={4}
            />
            <div className="mm-inspector-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={addChild}><Plus size={14} /> 子节点</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addSibling}><GitBranch size={14} /> 同级</button>
            </div>
            <div className="mm-inspector-move">
              <button type="button" className="text-btn" onClick={() => moveSelected(-1)}>上移</button>
              <button type="button" className="text-btn" onClick={() => moveSelected(1)}>下移</button>
              <span>{selectedNode.children?.length || 0} 个子节点</span>
            </div>
            <div className="mm-inspector-foot">
              <span>双击节点可直接改字</span>
              <button type="button" className="text-btn danger" onClick={deleteSelected} disabled={selectedNode.id === root.id}>
                删除
              </button>
            </div>
          </aside>
        ) : null}
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        eyebrow="DELETE MAP"
        title="删除这张思维导图？"
        width={420}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>取消</button>
            <button type="button" className="btn btn-danger" onClick={deleteMap} disabled={deleting}>
              {deleting ? '删除中…' : '删除导图'}
            </button>
          </>
        }
      >
        <p className="modal-text">《{title}》及其所有节点会被永久删除，此操作无法撤销。</p>
      </Modal>
    </div>
  );
}
