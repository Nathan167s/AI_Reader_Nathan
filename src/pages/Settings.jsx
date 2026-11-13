import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Cpu,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Loader2,
  LockKeyhole,
  Network,
  RotateCcw,
  Save,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import { READER_THEMES } from '../prefs.js';
import {
  FORMAT_NAMES,
  cx,
  formatBytes,
  formatNumber,
  formatDate,
  progressPercent,
} from '../utils.js';

const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: '推荐。中文阅读与结构化整理表现稳定。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '使用 OpenAI 兼容接口。',
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    model: '',
    hint: '支持任何 OpenAI 兼容的 Chat Completions 服务。',
  },
];

const SHORTCUTS = [
  ['Ctrl / ⌘ + K', '全局聚焦搜索'],
  ['Ctrl / ⌘ + F', '在书中搜索'],
  ['选中文字后右键', '快捷搜索 / 提问'],
  ['← / →', '阅读时切换章节'],
  ['Tab', '导图中添加子节点'],
  ['Enter', '导图中添加同级节点'],
  ['F2', '导图中编辑节点文字'],
  ['Ctrl / ⌘ + Z', '撤销导图修改'],
];

export default function Settings() {
  const { settings, stats, books, maps, prefs, setPrefs, refresh, toast } = useApp();
  const [provider, setProvider] = useState(settings?.ai?.provider || 'deepseek');
  const [baseUrl, setBaseUrl] = useState(settings?.ai?.baseUrl || '');
  const [model, setModel] = useState(settings?.ai?.model || '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settings?.ai) return;
    setProvider(settings.ai.provider || 'deepseek');
    setBaseUrl(settings.ai.baseUrl || '');
    setModel(settings.ai.model || '');
    setApiKey('');
    setClearKey(false);
  }, [settings]);

  const activeProvider = PROVIDERS.find((item) => item.id === provider) || PROVIDERS[2];
  const configured = Boolean(settings?.ai?.configured);
  const keySource = settings?.ai?.source || 'none';
  const localStats = useMemo(
    () => [
      { label: '藏书', value: `${books.length} 本`, icon: BookOpen },
      { label: '总字数', value: formatNumber(stats?.words || 0), icon: FileTextIcon },
      { label: '思维导图', value: `${maps.length} 张`, icon: Network },
      { label: '数据占用', value: formatBytes(stats?.storage || 0), icon: HardDrive },
    ],
    [books.length, stats, maps.length],
  );

  const chooseProvider = (item) => {
    setProvider(item.id);
    setTestResult(null);
    setError('');
    if (item.id !== 'custom') {
      setBaseUrl(item.baseUrl);
      setModel(item.model);
    }
    if (item.id === 'custom' && provider !== 'custom') {
      setBaseUrl(settings?.ai?.baseUrl || '');
      setModel(settings?.ai?.model || '');
    }
  };

  const save = async ({ quiet = false } = {}) => {
    setSaving(true);
    setError('');
    setTestResult(null);
    try {
      const payload = {
        ai: {
          provider,
          baseUrl,
          model,
          ...(apiKey.trim() && !apiKey.includes('•') ? { apiKey: apiKey.trim() } : {}),
        },
        clearKey,
      };
      const next = await api.saveSettings(payload);
      await refresh(true);
      setApiKey('');
      setClearKey(false);
      if (!quiet) toast('AI 设置已保存');
      return next;
    } catch (err) {
      setError(err.message);
      if (!quiet) toast(err.message, 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const saved = await save({ quiet: true });
      if (!saved) return;
      const result = await api.testAi();
      setTestResult(result);
      toast(`连接成功，用时 ${result.latency} ms`, 'success');
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const currentTheme = READER_THEMES.find((item) => item.id === prefs.theme) || READER_THEMES[0];

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="page settings-page">
      <header className="settings-head">
        <div>
          <p className="eyebrow">PREFERENCES · 让阅读更合手</p>
          <h1>设置 <em>与连接</em></h1>
          <p className="page-sub">AI 服务只在这台电脑上配置，书籍内容不会上传到别处。</p>
        </div>
        <span className={cx('settings-ai-pill', configured && 'is-ready')}>
          <span />
          {configured ? 'AI 已连接' : '本地模式'}
        </span>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav">
          <button type="button" onClick={() => scrollTo('settings-ai')}><Sparkles size={15} /> AI 服务</button>
          <button type="button" onClick={() => scrollTo('settings-reading')}><BookOpen size={15} /> 阅读外观</button>
          <button type="button" onClick={() => scrollTo('settings-data')}><Database size={15} /> 数据与隐私</button>
          <button type="button" onClick={() => scrollTo('settings-shortcuts')}><Cpu size={15} /> 快捷键</button>
          <button type="button" onClick={() => scrollTo('settings-about')}><LockKeyhole size={15} /> 关于</button>
        </nav>

        <div className="settings-content">
          <section className="settings-card" id="settings-ai">
            <div className="settings-card-head">
              <div>
                <p className="eyebrow">AI SERVICE</p>
                <h2>连接一个会读书的模型</h2>
                <p>配置后，快捷问答会基于原文归纳回答，思维导图也可由 AI 深度提炼。不配置也能使用全部阅读与本地检索功能。</p>
              </div>
              <span className={cx('settings-ai-pill', configured && 'is-ready')}>
                <span />
                {configured ? '已配置' : '未配置'}
              </span>
            </div>

            <div className="provider-tabs">
              {PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx('provider-tab', provider === item.id && 'is-active')}
                  onClick={() => chooseProvider(item)}
                >
                  <span>{item.name}</span>
                  {item.id === 'deepseek' ? <em>推荐</em> : null}
                </button>
              ))}
            </div>
            <p className="provider-hint">{activeProvider.hint}</p>

            <div className="settings-form-grid">
              <div className="field">
                <label htmlFor="ai-base">API 地址</label>
                <input
                  id="ai-base"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.deepseek.com"
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label htmlFor="ai-model">模型</label>
                <input
                  id="ai-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="deepseek-chat"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="ai-key">
                API Key
                {configured ? <span className="field-saved"><Check size={12} /> 已保存 {settings.ai.keyPreview}</span> : null}
              </label>
              <div className="key-input">
                <KeyRound size={16} />
                <input
                  id="ai-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setClearKey(false);
                  }}
                  placeholder={configured ? '留空则保留现有 Key' : 'sk-...'}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button type="button" className="key-eye" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隐藏 Key' : '显示 Key'}>
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="field-hint">
                {keySource === 'env'
                  ? '当前 Key 来自环境变量，保存的本地 Key 会优先使用。'
                  : 'Key 保存在本机 data/settings.json，不会发送给第三方，只会用于你选择的 AI 服务。'}
              </p>
            </div>

            {clearKey ? (
              <p className="form-warning">保存后将清除本机保存的 API Key。保存后仍可通过环境变量提供 Key。</p>
            ) : null}
            {error ? <div className="form-error">{error}</div> : null}
            {testResult ? (
              <div className="test-success">
                <Check size={16} />
                <span>连接成功 · 模型 {testResult.model} · {testResult.latency} ms</span>
                <small>“{testResult.reply}”</small>
              </div>
            ) : null}

            <div className="settings-actions">
              <button type="button" className="btn btn-primary" onClick={() => save()} disabled={saving}>
                {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                {saving ? '保存中…' : '保存设置'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={test} disabled={testing || saving}>
                {testing ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {testing ? '正在测试…' : '测试连接'}
              </button>
              {configured && keySource === 'local' ? (
                <button
                  type="button"
                  className="text-btn danger"
                  onClick={() => {
                    setClearKey(true);
                    setApiKey('');
                  }}
                >
                  清除本机 Key
                </button>
              ) : null}
              <span className="settings-path-hint"><LockKeyhole size={12} /> 仅本机保存</span>
            </div>
          </section>

          <section className="settings-card" id="settings-reading">
            <div className="settings-card-head">
              <div>
                <p className="eyebrow">READING</p>
                <h2>阅读外观</h2>
                <p>这些设置会同步到阅读器，只影响这台电脑上的显示。</p>
              </div>
              <button type="button" className="text-btn" onClick={() => setPrefs({ fontSize: 19, lineHeight: 2, width: 720, theme: 'paper' })}>
                <RotateCcw size={13} /> 恢复默认
              </button>
            </div>

            <div className="reading-settings-grid">
              <div className="reading-controls">
                <div className="settings-row">
                  <div><strong>纸张</strong><span>阅读背景与字色</span></div>
                  <div className="theme-swatches large">
                    {READER_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={cx('theme-swatch labeled', prefs.theme === theme.id && 'is-active')}
                        style={{ '--swatch-bg': theme.color, '--swatch-ink': theme.ink }}
                        onClick={() => setPrefs({ theme: theme.id })}
                      >
                        {prefs.theme === theme.id ? <Check size={12} /> : null}
                        <span>{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <div><strong>字号</strong><span>{prefs.fontSize} px</span></div>
                  <input
                    type="range"
                    min="15"
                    max="26"
                    step="1"
                    value={prefs.fontSize}
                    onChange={(event) => setPrefs({ fontSize: Number(event.target.value) })}
                  />
                </div>
                <div className="settings-row">
                  <div><strong>行距</strong><span>{prefs.lineHeight}</span></div>
                  <div className="segmented">
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
                <div className="settings-row">
                  <div><strong>版心宽度</strong><span>{prefs.width} px</span></div>
                  <div className="segmented">
                    {[{ label: '窄', value: 620 }, { label: '中', value: 720 }, { label: '宽', value: 820 }].map((item) => (
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
              </div>

              <div
                className="reading-preview"
                style={{ '--preview-bg': currentTheme.color, '--preview-ink': currentTheme.ink }}
              >
                <span className="preview-label">PREVIEW</span>
                <h3>把光留给句子</h3>
                <p style={{ fontSize: `${Math.min(19, prefs.fontSize)}px`, lineHeight: prefs.lineHeight }}>
                  阅读不是把文字从纸上搬进脑子，而是允许一个陌生的声音，在自己的生活里停留得久一点。
                </p>
                <span className="preview-rule" />
                <small>{currentTheme.name} · {prefs.fontSize}px · 行距 {prefs.lineHeight}</small>
              </div>
            </div>
          </section>

          <section className="settings-card" id="settings-data">
            <div className="settings-card-head">
              <div>
                <p className="eyebrow">DATA & PRIVACY</p>
                <h2>数据与隐私</h2>
                <p>页间是本地优先的。书架、摘录、问答记录和思维导图都保存在项目目录里，不需要注册账号。</p>
              </div>
              <span className="privacy-badge"><LockKeyhole size={13} /> 本地优先</span>
            </div>

            <div className="data-stats">
              {localStats.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label}>
                    <span className="data-icon"><Icon size={17} /></span>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>

            <div className="privacy-grid">
              <div>
                <h3><HardDrive size={16} /> 存在哪里</h3>
                <p>书籍原始文件、解析正文、思维导图与对话都在项目的 <code>data/</code> 目录。删除书籍时，对应文件会一并移除。</p>
              </div>
              <div>
                <h3><Database size={16} /> 什么会离开本机</h3>
                <p>只有在你配置 AI 并提问时，命中的原文片段才会发送给所选的 AI 服务。阅读、搜索、本地导图生成都不联网。</p>
              </div>
              <div>
                <h3><Wand2 size={16} /> 备份方式</h3>
                <p>复制整个 <code>data/</code> 文件夹即可迁移书架。思维导图也可以在编辑器里单独导出 PNG、SVG、Markdown 或 JSON。</p>
              </div>
            </div>
          </section>

          <section className="settings-card" id="settings-shortcuts">
            <div className="settings-card-head">
              <div>
                <p className="eyebrow">SHORTCUTS</p>
                <h2>让手比眼快一点</h2>
              </div>
            </div>
            <div className="shortcut-grid">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys}>
                  <kbd>{keys}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-card about-card" id="settings-about">
            <div className="about-mark">页</div>
            <div>
              <h2>页间 <em>PageNest</em></h2>
              <p>一个把阅读、提问与结构化思考放在一起的本地工作台。支持 TXT、PDF、Word、HTML、EPUB 与微信公众号文章。</p>
              <div className="about-meta">
                <span>版本 1.0.0</span>
                <span>React · Node.js · PDF.js</span>
                <span>数据最后更新 {formatDate(new Date().toISOString())}</span>
              </div>
            </div>
            <button type="button" className="text-link" onClick={() => scrollTo('settings-ai')}>
              返回 AI 设置 <ArrowRight size={13} />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function FileTextIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}
