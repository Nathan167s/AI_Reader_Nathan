import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Loader2,
  Network,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import {
  MAP_THEMES,
  cx,
  navigate,
  relativeTime,
  truncate,
} from '../utils.js';

function MiniMap({ map }) {
  const theme = MAP_THEMES[map.theme] || MAP_THEMES.forest;
  const branches = map.preview?.branches?.length
    ? map.preview.branches
    : [{ text: '开始记录想法', count: 0 }];
  const height = Math.max(138, 38 + branches.length * 25);
  const centerY = height / 2;
  const spread = Math.min(104, branches.length * 23);
  return (
    <div className="map-thumb" style={{ '--map-paper': theme.paper }}>
      <svg viewBox={`0 0 320 ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect width="320" height={height} fill={theme.paper} />
        {branches.slice(0, 6).map((branch, index) => {
          const count = Math.min(6, branches.length);
          const y = centerY - spread / 2 + (count === 1 ? 0 : (index * spread) / (count - 1));
          const color = theme.branch[index % theme.branch.length];
          return (
            <g key={index}>
              <path
                d={`M 102 ${centerY} C 142 ${centerY}, 148 ${y}, 190 ${y}`}
                fill="none"
                stroke={color}
                strokeWidth="1.7"
                strokeOpacity=".62"
              />
              <circle cx="194" cy={y} r="3.4" fill={color} opacity=".9" />
              <text x="204" y={y + 4.2} fontSize="10.5" fill="#3b453f" fontFamily="Microsoft YaHei, sans-serif">
                {truncate(branch.text, 11)}
              </text>
            </g>
          );
        })}
        <rect x="28" y={centerY - 22} width="84" height="44" rx="12" fill={theme.root} />
        <text x="70" y={centerY + 4} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={theme.rootInk} fontFamily="Microsoft YaHei, sans-serif">
          {truncate(map.preview?.root || map.title, 6)}
        </text>
        <circle cx="26" cy="22" r="8" fill={theme.accent} opacity=".12" />
        <circle cx="300" cy={height - 20} r="18" fill="none" stroke={theme.accent} strokeOpacity=".18" />
      </svg>
    </div>
  );
}

export default function Maps() {
  const { maps, books, settings, refresh, toast } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [mode, setMode] = useState('book');
  const [bookId, setBookId] = useState('');
  const [genMode, setGenMode] = useState('local');
  const [prompt, setPrompt] = useState('');
  const [blankTitle, setBlankTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const aiReady = Boolean(settings?.ai?.configured);
  const linkedBooks = useMemo(
    () => new Set(maps.map((map) => map.bookId).filter(Boolean)).size,
    [maps],
  );

  useEffect(() => {
    if (!createOpen) return;
    setMode(books.length ? 'book' : 'blank');
    setBookId(books[0]?.id || '');
    setGenMode(aiReady ? 'ai' : 'local');
    setPrompt('');
    setBlankTitle('');
    setError('');
    setBusy(false);
  }, [createOpen, books, aiReady]);

  const generate = async () => {
    if (mode === 'blank') {
      if (!blankTitle.trim()) {
        setError('先给导图起一个名字');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const map = await api.createMap({
          title: blankTitle.trim(),
          root: {
            text: blankTitle.trim(),
            note: '',
            children: [
              { text: '双击节点开始编辑', note: '', children: [] },
              { text: 'Tab 添加子节点', note: '', children: [] },
            ],
          },
        });
        await refresh(true);
        setCreateOpen(false);
        navigate(`/maps/${map.id}`);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!bookId) {
      setError('先选择一本作为来源的书');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.generateMap({
        bookId,
        mode: genMode,
        prompt: prompt.trim(),
      });
      await refresh(true);
      setCreateOpen(false);
      toast(result.mode === 'ai' ? 'AI 已生成思维导图' : '已从原文结构生成导图');
      navigate(`/maps/${result.map.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeMap = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteMap(deleteTarget.id);
      await refresh(true);
      toast('思维导图已删除');
      setDeleteTarget(null);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page maps-page">
      <header className="maps-head">
        <div>
          <p className="eyebrow">MIND MAPS · 把书读成结构</p>
          <h1>思维导图 <em>工作台</em></h1>
          <p className="page-sub">
            从原文自动提炼，也可以从一个空白节点开始，把想法一根根接起来。
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={17} /> 新建导图
        </button>
      </header>

      <div className="maps-stats">
        <span><Network size={15} /> {maps.length} 张导图</span>
        <span><BookOpen size={15} /> 关联 {linkedBooks} 本书</span>
        <span className={cx('ai-status-pill', aiReady && 'is-ready')}>
          <Sparkles size={14} /> {aiReady ? 'AI 提炼已就绪' : '本地结构提取'}
        </span>
      </div>

      {maps.length === 0 ? (
        <div className="maps-empty">
          <div className="maps-empty-art">
            <span className="map-orbit one" />
            <span className="map-orbit two" />
            <Network size={38} strokeWidth={1.3} />
          </div>
          <h2>让一本书长出一张地图</h2>
          <p>选择一本藏书，自动提取章节与关键观点；或者新建空白画布，手动梳理。</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Wand2 size={17} /> 生成第一张导图
          </button>
        </div>
      ) : (
        <div className="maps-grid">
          {maps.map((map) => {
            const theme = MAP_THEMES[map.theme] || MAP_THEMES.forest;
            return (
              <article className="map-card" key={map.id}>
                <button type="button" className="map-card-main" onClick={() => navigate(`/maps/${map.id}`)}>
                  <MiniMap map={map} />
                  <div className="map-card-body">
                    <div className="map-card-title-row">
                      <h3>{map.title}</h3>
                      <ArrowRight size={16} />
                    </div>
                    <p>{map.bookTitle ? `来自《${truncate(map.bookTitle, 28)}》` : '独立画布'}</p>
                    <div className="map-card-meta">
                      <span className={`map-theme-dot theme-${map.theme}`} />
                      <span>{MAP_THEMES[map.theme]?.name || '松林'}</span>
                      <span>{map.nodeCount} 个节点</span>
                      <span>{relativeTime(map.updatedAt)}</span>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="map-card-delete"
                  title="删除导图"
                  onClick={() => setDeleteTarget(map)}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            );
          })}
          <button type="button" className="map-add-card" onClick={() => setCreateOpen(true)}>
            <span><Plus size={22} /></span>
            <strong>新的思维导图</strong>
            <small>从书生成，或从空白开始</small>
          </button>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => { if (!busy) setCreateOpen(false); }}
        eyebrow="NEW MIND MAP"
        title="新建思维导图"
        width={620}
      >
        <div className="create-tabs">
          <button type="button" className={cx(mode === 'book' && 'is-active')} onClick={() => setMode('book')}>
            <Wand2 size={16} /> 从书生成
          </button>
          <button type="button" className={cx(mode === 'blank' && 'is-active')} onClick={() => setMode('blank')}>
            <Plus size={16} /> 空白画布
          </button>
        </div>

        {mode === 'book' ? (
          <div className="create-body">
            <div className="field">
              <label htmlFor="map-book">来源书籍</label>
              {books.length ? (
                <select
                  id="map-book"
                  value={bookId}
                  onChange={(event) => setBookId(event.target.value)}
                  disabled={busy}
                >
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title} · {book.chapterCount || 1} 节
                    </option>
                  ))}
                </select>
              ) : (
                <div className="create-note">
                  <BookOpen size={17} />
                  <span>书架还是空的，先去导入一本书。</span>
                </div>
              )}
            </div>

            <div className="field">
              <label>提炼方式</label>
              <div className="mode-cards">
                <button
                  type="button"
                  className={cx('mode-card', genMode === 'local' && 'is-active')}
                  onClick={() => setGenMode('local')}
                  disabled={busy}
                >
                  <span className="mode-icon"><Network size={18} /></span>
                  <span><strong>本地结构提取</strong><small>读取章节、小标题与关键句，离线可用</small></span>
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
                    <strong>AI 深度提炼 {aiReady ? null : <em>未配置</em>}</strong>
                    <small>理解全文，重组为更凝练的观点树</small>
                  </span>
                </button>
              </div>
            </div>

            {genMode === 'ai' && aiReady ? (
              <div className="field">
                <label htmlFor="map-prompt">额外要求 <span>可选</span></label>
                <input
                  id="map-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="例如：侧重方法论，保留作者的反例"
                  disabled={busy}
                />
              </div>
            ) : null}

            <div className="create-note">
              <Sparkles size={17} />
              <span>生成后仍可自由增删节点、修改文字与备注，所有改动会自动保存。</span>
            </div>
          </div>
        ) : (
          <div className="create-body">
            <div className="field">
              <label htmlFor="map-title">中心主题</label>
              <input
                id="map-title"
                autoFocus
                value={blankTitle}
                onChange={(event) => setBlankTitle(event.target.value)}
                placeholder="例如：下一年的阅读计划"
                disabled={busy}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') generate();
                }}
              />
              <p className="field-hint">创建后双击节点编辑，按 Tab 添加子节点，Enter 添加同级。</p>
            </div>
          </div>
        )}

        {error ? <div className="form-error">{error}</div> : null}

        <div className="create-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={generate}
            disabled={busy || (mode === 'book' && !books.length)}
          >
            {busy ? (
              <><Loader2 size={16} className="spin" /> {mode === 'blank' ? '创建中…' : '正在阅读与提炼…'}</>
            ) : (
              <>{mode === 'blank' ? '创建画布' : '生成思维导图'} <ArrowRight size={15} /></>
            )}
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        eyebrow="DELETE MAP"
        title="删除这张思维导图？"
        width={420}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>取消</button>
            <button type="button" className="btn btn-danger" onClick={removeMap}>
              <Trash2 size={15} /> 删除
            </button>
          </>
        }
      >
        <p className="modal-text">《{deleteTarget?.title}》及其所有节点会被永久删除，此操作无法撤销。</p>
      </Modal>
    </div>
  );
}
