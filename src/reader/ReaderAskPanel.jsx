import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Database,
  Globe2,
  Loader2,
  MessageCircleQuestion,
  RefreshCcw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import WebSources from '../components/WebSources.jsx';
import { cx, navigate, truncate } from '../utils.js';

const MODE_KEY = 'pagenest.reader.qaMode.v1';
const SCOPE_KEY = 'pagenest.reader.qaScope.v1';
const WEB_KEY = 'pagenest.reader.webSearch.v1';
const TOP_COLLAPSED_KEY = 'pagenest.reader.askTopCollapsed.v1';

const STRICT_PROMPTS = [
  '用三句话概括这一节',
  '解释这里最关键的概念',
  '就这一节出 3 道理解题',
  '作者在这里想反驳什么？',
];

const FREE_PROMPTS = [
  '补充作者所处的时代背景',
  '解释这个概念，并给一个生活例子',
  '这个观点在今天还成立吗？',
  '这本书和同主题经典有什么不同？',
];

function sourceLocation(source) {
  return source.page ? `第 ${source.page} 页` : source.chapterTitle || '原文';
}

export default function ReaderAskPanel({
  book,
  chapterIndex,
  chapterTitle,
  isPdf = false,
  pdfTextPages,
  promptRequest,
  onPromptConsumed,
  onJumpSource,
}) {
  const { settings, toast } = useApp();
  const aiReady = Boolean(settings?.ai?.configured);
  const scannedPdf = isPdf && pdfTextPages === 0;
  const [qaMode, setQaMode] = useState(() =>
    localStorage.getItem(MODE_KEY) === 'free' ? 'free' : 'strict',
  );
  const [scope, setScope] = useState(() => localStorage.getItem(SCOPE_KEY) || 'chapter');
  const [webSearch, setWebSearch] = useState(
    () => localStorage.getItem(WEB_KEY) === '1',
  );
  const [topCollapsed, setTopCollapsed] = useState(
    () => localStorage.getItem(TOP_COLLAPSED_KEY) === '1',
  );
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  const chapterLabel = isPdf ? `第 ${chapterIndex + 1} 页` : chapterTitle || '本节';
  const suggestionList = qaMode === 'strict' ? STRICT_PROMPTS : FREE_PROMPTS;
  const canSend =
    Boolean(draft.trim()) &&
    !sending &&
    (qaMode === 'strict' || aiReady) &&
    (!webSearch || aiReady);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    localStorage.setItem(MODE_KEY, qaMode);
  }, [qaMode]);

  useEffect(() => {
    localStorage.setItem(SCOPE_KEY, scope);
  }, [scope]);

  useEffect(() => {
    localStorage.setItem(WEB_KEY, webSearch ? '1' : '0');
  }, [webSearch]);

  useEffect(() => {
    localStorage.setItem(TOP_COLLAPSED_KEY, topCollapsed ? '1' : '0');
  }, [topCollapsed]);

  useEffect(() => {
    if (!promptRequest?.text) return;
    setDraft(promptRequest.text);
    setError('');
    setTimeout(() => textareaRef.current?.focus(), 80);
    onPromptConsumed?.();
  }, [promptRequest?.nonce, onPromptConsumed, promptRequest?.text]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(136, Math.max(24, element.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const send = async (preset) => {
    const question = (preset ?? draft).trim();
    if (!question || sending) return;
    if (qaMode === 'free' && !aiReady) {
      setError('自由拓展模式需要先在设置中配置 AI 服务。');
      return;
    }
    const optimistic = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: question,
      qaMode,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft('');
    setSending(true);
    setError('');
    try {
      const result = await api.ask({
        question,
        threadId,
        bookIds: [book.id],
        qaMode,
        scope,
        chapterIndex: scope === 'chapter' ? chapterIndex : null,
        webSearch,
      });
      setThreadId(result.thread.id);
      setMessages(result.thread.messages || []);
      if (result.warning) {
        toast(result.warning, 'info');
      }
    } catch (err) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(question);
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const copyAnswer = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast('已复制回答');
    } catch {
      toast('复制失败', 'error');
    }
  };

  const resetChat = () => {
    setThreadId(null);
    setMessages([]);
    setDraft('');
    setError('');
    setTimeout(() => textareaRef.current?.focus(), 80);
  };

  return (
    <div className="reader-ask-panel">
      <div className={cx('qa-panel-top', topCollapsed && 'is-collapsed')}>
        <button
          type="button"
          className="qa-top-toggle"
          onClick={() => setTopCollapsed((value) => !value)}
          aria-expanded={!topCollapsed}
          title={topCollapsed ? '展开问答设置' : '收起问答设置'}
        >
          <span>{topCollapsed ? '问答设置' : '收起设置'}</span>
          <small>
            {qaMode === 'strict' ? '严格素材' : '自由拓展'} ·{' '}
            {scope === 'chapter' ? (isPdf ? '本页' : '本节') : '全书'}
            {webSearch ? ' · 联网' : ''}
          </small>
          <ChevronDown
            size={14}
            className={cx('qa-top-toggle-icon', !topCollapsed && 'is-open')}
          />
        </button>

        <div className="qa-panel-top-body">
        <div className="qa-mode-switch">
          <button
            type="button"
            className={cx('qa-mode-btn', qaMode === 'strict' && 'is-active')}
            onClick={() => { setQaMode('strict'); setError(''); }}
          >
            <ShieldCheck size={15} />
            <span>严格素材<small>只读原文，禁止编造</small></span>
          </button>
          <button
            type="button"
            className={cx('qa-mode-btn', qaMode === 'free' && 'is-active')}
            onClick={() => { setQaMode('free'); setError(''); }}
          >
            <Wand2 size={15} />
            <span>自由拓展<small>通用问答，可查背景</small></span>
          </button>
        </div>

        <div className="qa-scope-row">
          <div className="segmented small">
            <button
              type="button"
              className={scope === 'chapter' ? 'is-active' : ''}
              onClick={() => setScope('chapter')}
            >
              {isPdf ? '本页' : '本节'}
            </button>
            <button
              type="button"
              className={scope === 'book' ? 'is-active' : ''}
              onClick={() => setScope('book')}
            >
              全书
            </button>
          </div>
          <span className="qa-scope-label" title={chapterLabel}>
            {scope === 'chapter' ? truncate(chapterLabel, 18) : truncate(book.title, 20)}
          </span>
          <button type="button" className="qa-new-chat" onClick={resetChat} title="开始新的对话">
            <RefreshCcw size={13} /> 新对话
          </button>
        </div>

        <button
          type="button"
          className={cx('qa-web-toggle', webSearch && 'is-active')}
          onClick={() => {
            if (!aiReady) {
              setError('联网搜索需要配置 AI 后才能综合回答。');
              return;
            }
            setWebSearch((value) => !value);
            setError('');
          }}
          disabled={!aiReady}
          title={aiReady ? '联网补充资料会排在本书素材之后' : '需要先配置 AI'}
        >
          <Globe2 size={14} />
          <span>联网补充</span>
          <small>{webSearch ? '已开启 · 网络来源会单独标注' : '本书素材不足时再查网络'}</small>
          <i className={webSearch ? 'is-on' : ''} />
        </button>

        <p className="qa-mode-hint">
          {qaMode === 'strict'
            ? webSearch
              ? '优先使用本书原文；仅补充联网检索到的外部资料，并标注【网络来源】。不使用模型自身知识。'
              : '只依据当前范围的原文回答；原文没有的内容会直接说明，不调用模型知识。适合解读、做题与文本问答。'
            : webSearch
              ? '素材作为参考，允许模型知识；外部信息会区分“补充背景”和“网络来源”。'
              : '素材作为参考，允许调用模型自身知识；外部信息会标注“补充背景”。适合延伸讨论、人物时代与概念解释。'}
        </p>
        {scannedPdf ? (
          <div className="qa-pdf-warning">
            <BookOpen size={13} />
            <span>这份 PDF 没有文字层，原文检索为空；可先 OCR 后重新导入，或粘贴 OCR 文本。</span>
          </div>
        ) : null}
        {qaMode === 'free' && !aiReady ? (
          <button type="button" className="qa-mode-warning" onClick={() => navigate('/settings')}>
            <Settings size={14} />
            自由拓展需要配置 AI 服务，点击去设置
            <ArrowRight size={13} />
          </button>
        ) : null}
        </div>
      </div>

      <div className="qa-panel-scroll">
        {!hasMessages && !sending ? (
          <div className="qa-panel-empty">
            <span className="qa-empty-orb"><MessageCircleQuestion size={22} /></span>
            <p className="eyebrow">READ ALONGSIDE</p>
            <h3>就在这一{isPdf ? '页' : '节'}，问点什么</h3>
            <p>
              {qaMode === 'strict'
                ? '我会只使用这一范围的原文，回答、解释或出题。'
                : '我会把原文当作参考，也可以补充相关的背景知识。'}
            </p>
            <div className="qa-suggestions">
              {suggestionList.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => send(item)}
                  disabled={qaMode === 'free' && !aiReady}
                >
                  <Sparkles size={12} />
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="qa-panel-messages">
            {messages.map((message) => (
              <div key={message.id} className={cx('qa-msg', `qa-msg-${message.role}`)}>
                {message.role === 'user' ? (
                  <div className="qa-user-bubble">{message.content}</div>
                ) : (
                  <div className="qa-assistant">
                    <div className="qa-assistant-head">
                      <span className="qa-avatar">页</span>
                      <span className="qa-mode-tag">
                        {message.qaMode === 'free' ? <Wand2 size={10} /> : <ShieldCheck size={10} />}
                        {message.qaMode === 'free' ? '自由拓展' : '严格素材'}
                      </span>
                      <span className="qa-provider-tag">
                        {message.mode === 'ai' ? 'AI' : '本地检索'}
                        {message.webSources?.length ? ' · 联网' : ''}
                      </span>
                      <button type="button" className="qa-copy" onClick={() => copyAnswer(message)}>
                        <Copy size={12} /> 复制
                      </button>
                    </div>
                    <Markdown content={message.content} className="qa-markdown" />
                    {message.sources?.length ? (
                      <div className="qa-sources">
                        <p><Database size={11} /> 参考原文</p>
                        {message.sources.map((source, index) => (
                          <button
                            key={`${source.bookId}-${index}`}
                            type="button"
                            onClick={() => onJumpSource?.(source)}
                          >
                            <span>{index + 1}</span>
                            <span>
                              <strong>{truncate(source.bookTitle, 18)}</strong>
                              <small>{sourceLocation(source)}</small>
                            </span>
                            <ArrowRight size={11} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <WebSources
                      sources={message.webSources}
                      query={message.searchQuery}
                    />
                  </div>
                )}
              </div>
            ))}
            {sending ? (
              <div className="qa-msg qa-msg-assistant">
                <div className="qa-assistant">
                  <div className="qa-assistant-head">
                    <span className="qa-avatar">页</span>
                    <span className="qa-mode-tag">
                      {qaMode === 'free' ? <Wand2 size={10} /> : <ShieldCheck size={10} />}
                      {qaMode === 'free' ? '自由拓展' : '严格素材'}
                    </span>
                  </div>
                  <div className="typing-bubble"><span /><span /><span /></div>
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="qa-panel-composer">
        {error ? (
          <div className="qa-panel-error">
            <span>{error}</span>
            {error.includes('AI') || error.includes('配置') ? (
              <button type="button" onClick={() => navigate('/settings')}>去设置</button>
            ) : null}
          </div>
        ) : null}
        <div className="qa-composer-box">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={qaMode === 'strict' ? '针对原文提问、解读或出题…' : '问一个需要背景知识的问题…'}
            rows={1}
            disabled={sending}
          />
          <div className="qa-composer-bar">
            <span>
              <BookOpen size={12} />
              {scope === 'chapter' ? truncate(chapterLabel, 14) : '全书'}
            </span>
            <span className="qa-composer-hint">Enter 发送</span>
            <button
              type="button"
              className="qa-send"
              onClick={() => send()}
              disabled={!canSend}
              title={qaMode === 'free' && !aiReady ? '自由拓展需要配置 AI' : '发送'}
            >
              {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
        <p className="qa-disclaimer">
          {qaMode === 'strict' ? '严格模式不会使用素材以外的知识。' : '自由模式会混合原文与模型知识，请留意“补充背景”标注。'}
        </p>
      </div>
    </div>
  );
}
