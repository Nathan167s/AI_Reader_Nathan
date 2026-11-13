import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Database,
  Globe2,
  Loader2,
  MessageCircleQuestion,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import WebSources from '../components/WebSources.jsx';
import {
  cx,
  navigate,
  relativeTime,
  truncate,
} from '../utils.js';

function MessageSources({ sources, onOpen }) {
  if (!sources?.length) return null;
  return (
    <div className="message-sources">
      <p className="sources-label"><Database size={13} /> 参考原文</p>
      <div className="source-grid">
        {sources.map((source, index) => (
          <button
            key={`${source.bookId}-${source.chapterIndex}-${index}`}
            type="button"
            className="source-card"
            onClick={() => onOpen(source)}
          >
            <span className="source-index">{index + 1}</span>
            <span className="source-main">
              <strong>{truncate(source.bookTitle, 26)}</strong>
              <small>{source.page ? `第 ${source.page} 页` : truncate(source.chapterTitle, 20)}</small>
              <span>{source.snippet}</span>
            </span>
            <ArrowRight size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Ask() {
  const {
    books,
    settings,
    route,
    openBook,
    toast,
    refresh,
  } = useApp();
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [bookIds, setBookIds] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [qaMode, setQaMode] = useState(() =>
    localStorage.getItem('pagenest.ask.qaMode') === 'free' ? 'free' : 'strict',
  );
  const [webSearch, setWebSearch] = useState(
    () => localStorage.getItem('pagenest.ask.webSearch') === '1',
  );
  const [contextOpen, setContextOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [copiedId, setCopiedId] = useState('');
  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const contextRef = useRef(null);

  const activeThread = threads.find((thread) => thread.id === activeId) || null;
  const selectedBooks = useMemo(
    () => books.filter((book) => bookIds.includes(book.id)),
    [books, bookIds],
  );
  const contextLabel = selectedBooks.length
    ? selectedBooks.length === 1
      ? `《${truncate(selectedBooks[0].title, 16)}》`
      : `已选 ${selectedBooks.length} 本书`
    : '全部书库';
  const aiReady = Boolean(settings?.ai?.configured);
  const suggestions = useMemo(() => {
    const first = books[0];
    if (!first) return [];
    return [
      `用三句话概括《${first.title}》`,
      `《${first.title}》里最值得追问的问题是什么？`,
      `把《${first.title}》整理成一张思维导图`,
      '我的书架上有哪些反复出现的主题？',
    ];
  }, [books]);

  useEffect(() => {
    localStorage.setItem('pagenest.ask.qaMode', qaMode);
  }, [qaMode]);

  useEffect(() => {
    localStorage.setItem('pagenest.ask.webSearch', webSearch ? '1' : '0');
  }, [webSearch]);

  useEffect(() => {
    let alive = true;
    api
      .getThreads()
      .then((list) => {
        if (!alive) return;
        setThreads(list);
        const threadId = route.query.get('thread');
        if (threadId) {
          const thread = list.find((item) => item.id === threadId);
          if (thread) {
            setActiveId(thread.id);
            setMessages(thread.messages || []);
            setBookIds(thread.bookIds || []);
          }
        }
      })
      .catch((err) => toast(err.message, 'error'))
      .finally(() => {
        if (alive) setLoadingThreads(false);
      });
    return () => {
      alive = false;
    };
  }, [toast, route.query]);

  useEffect(() => {
    const q = route.query.get('q');
    const book = route.query.get('book');
    if (q) setDraft(q);
    if (book) setBookIds([book]);
    if (q) setTimeout(() => textareaRef.current?.focus(), 180);
  }, [route.query]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(172, Math.max(26, element.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  useEffect(() => {
    if (!contextOpen) return undefined;
    const close = (event) => {
      if (!contextRef.current?.contains(event.target)) setContextOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [contextOpen]);

  const chooseThread = (thread) => {
    setActiveId(thread.id);
    setMessages(thread.messages || []);
    setBookIds(thread.bookIds || []);
    setQaMode(thread.qaMode === 'free' ? 'free' : 'strict');
    setThreadsOpen(false);
    setDraft('');
  };

  const newThread = () => {
    setActiveId(null);
    setMessages([]);
    setBookIds([]);
    setDraft('');
    setThreadsOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const toggleBook = (id) => {
    const next = bookIds.includes(id)
      ? bookIds.filter((item) => item !== id)
      : [...bookIds, id];
    setBookIds(next);
    if (activeId) {
      api.updateThread(activeId, { bookIds: next }).catch(() => {});
      setThreads((current) =>
        current.map((thread) => (thread.id === activeId ? { ...thread, bookIds: next } : thread)),
      );
    }
  };

  const removeThread = async (event, thread) => {
    event.stopPropagation();
    try {
      await api.deleteThread(thread.id);
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      if (activeId === thread.id) {
        setActiveId(null);
        setMessages([]);
      }
      toast('对话已删除');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const send = async (preset) => {
    const question = (preset ?? draft).trim();
    if (!question || sending) return;
    if (qaMode === 'free' && !aiReady) {
      toast('自由拓展模式需要先在设置中配置 AI', 'error');
      return;
    }
    if (webSearch && !aiReady) {
      toast('联网搜索需要先配置 AI', 'error');
      return;
    }
    const optimistic = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: question,
      sources: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft('');
    setSending(true);
    try {
      const result = await api.ask({
        question,
        threadId: activeId,
        bookIds,
        qaMode,
        scope: 'book',
        webSearch,
      });
      setActiveId(result.thread.id);
      setMessages(result.thread.messages || []);
      setBookIds(result.thread.bookIds || []);
      setThreads((current) => {
        const exists = current.some((thread) => thread.id === result.thread.id);
        return exists
          ? current.map((thread) => (thread.id === result.thread.id ? result.thread : thread))
          : [result.thread, ...current];
      });
      if (result.warning) toast(result.warning, 'info');
      refresh(true).catch(() => {});
    } catch (err) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(question);
      toast(err.message, 'error');
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const copyAnswer = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(''), 1500);
    } catch {
      toast('复制失败', 'error');
    }
  };

  const openSource = (source) => {
    openBook(source.bookId, {
      chapter: source.chapterIndex,
      page: source.page,
    });
  };

  return (
    <div className="ask-page">
      <aside className={cx('ask-side', threadsOpen && 'is-open')}>
        <div className="ask-side-head">
          <div>
            <p className="eyebrow">CONVERSATIONS</p>
            <h1>问答</h1>
          </div>
          <button type="button" className="icon-btn ask-side-close" onClick={() => setThreadsOpen(false)} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <button type="button" className="new-chat-btn" onClick={newThread}>
          <Plus size={16} /> 新的对话
        </button>
        <div className="thread-list">
          {loadingThreads ? (
            <div className="thread-loading"><Loader2 size={16} className="spin" /> 正在整理对话…</div>
          ) : threads.length ? (
            threads.map((thread) => (
              <div
                key={thread.id}
                className={cx('thread-item', thread.id === activeId && 'is-active')}
              >
                <button
                  type="button"
                  className="thread-open"
                  onClick={() => chooseThread(thread)}
                >
                  <span className="thread-glyph"><MessageCircleQuestion size={15} /></span>
                  <span className="thread-copy">
                    <strong>{thread.title || '未命名对话'}</strong>
                    <small>{relativeTime(thread.updatedAt)} · {thread.messages?.length || 0} 条</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="thread-delete"
                  onClick={(event) => removeThread(event, thread)}
                  aria-label="删除对话"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          ) : (
            <div className="thread-empty">
              <Sparkles size={18} />
              <p>还没有对话</p>
              <span>从一个具体的问题开始。</span>
            </div>
          )}
        </div>
        <div className="ask-side-foot">
          <div className={cx('ai-status', aiReady ? 'is-ready' : '')}>
            <span />
            <div>
              <strong>{aiReady ? 'AI 已连接' : '本地检索模式'}</strong>
              <small>{aiReady ? settings.ai.model : '接入模型可获得归纳回答'}</small>
            </div>
          </div>
          <button type="button" className="text-link" onClick={() => navigate('/settings')}>
            配置 AI 服务 <ArrowRight size={13} />
          </button>
        </div>
      </aside>

      <main className="chat-main">
        <header className="chat-head">
          <div className="chat-head-title">
            <button type="button" className="icon-btn chat-menu-btn" onClick={() => setThreadsOpen(true)} aria-label="打开对话列表">
              <MessageCircleQuestion size={18} />
            </button>
            <div>
              <p className="eyebrow">ASK THE SHELF</p>
              <h1>{activeThread?.title || '快捷问答'}</h1>
            </div>
          </div>
          <div className="chat-head-actions">
            <div className="ask-mode-toggle">
              <button
                type="button"
                className={cx(qaMode === 'strict' && 'is-active')}
                onClick={() => setQaMode('strict')}
              >
                严格素材
              </button>
              <button
                type="button"
                className={cx(qaMode === 'free' && 'is-active')}
                onClick={() => setQaMode('free')}
              >
                自由拓展
              </button>
            </div>
            <button
              type="button"
              className={cx('ask-web-toggle', webSearch && 'is-active')}
              onClick={() => {
                if (!aiReady) {
                  toast('联网搜索需要先配置 AI', 'error');
                  return;
                }
                setWebSearch((value) => !value);
              }}
              disabled={!aiReady}
              title={aiReady ? '联网补充资料排在本书素材之后' : '需要配置 AI'}
            >
              <Globe2 size={14} /> 联网
            </button>
            <div className="context-wrap" ref={contextRef}>
              <button
                type="button"
                className={cx('context-trigger', contextOpen && 'is-open')}
                onClick={() => setContextOpen((value) => !value)}
              >
                <Database size={15} />
                <span>{contextLabel}</span>
                <ChevronDown size={14} />
              </button>
              {contextOpen ? (
                <div className="context-pop">
                  <div className="context-pop-head">
                    <strong>选择问答范围</strong>
                    <span>{selectedBooks.length ? `已选 ${selectedBooks.length} 本` : '默认检索全部藏书'}</span>
                  </div>
                  <button
                    type="button"
                    className={cx('context-all', !bookIds.length && 'is-active')}
                    onClick={() => {
                      setBookIds([]);
                      if (activeId) {
                        api.updateThread(activeId, { bookIds: [] }).catch(() => {});
                        setThreads((current) =>
                          current.map((thread) => (thread.id === activeId ? { ...thread, bookIds: [] } : thread)),
                        );
                      }
                    }}
                  >
                    <span className="context-all-icon"><Sparkles size={15} /></span>
                    <span><strong>全部书库</strong><small>在最近阅读的书里智能检索</small></span>
                    {!bookIds.length ? <Check size={16} /> : null}
                  </button>
                  <div className="context-book-list">
                    {books.map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        className={cx('context-book', bookIds.includes(book.id) && 'is-active')}
                        onClick={() => toggleBook(book.id)}
                      >
                        <span className={`context-book-dot fmt-${book.format}`} />
                        <span><strong>{book.title}</strong><small>{book.author || '佚名'}</small></span>
                        <span className="context-check">
                          {bookIds.includes(book.id) ? <Check size={13} /> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                  {!books.length ? <p className="context-empty">书架还是空的。</p> : null}
                </div>
              ) : null}
            </div>
            <button type="button" className="btn btn-ghost btn-sm chat-new-btn" onClick={newThread}>
              <Plus size={15} /> 新对话
            </button>
          </div>
        </header>

        {!aiReady ? (
          <div className="ask-mode-banner">
            <Sparkles size={15} />
            <span>
              {qaMode === 'free'
                ? <><strong>自由拓展需要 AI。</strong> 请在设置中接入模型，或切回严格素材模式使用本地检索。</>
                : <><strong>严格素材当前为本地检索。</strong> 接入 AI 后，可以基于原文归纳、解读与出题。</>}
            </span>
            <button type="button" className="text-link" onClick={() => navigate('/settings')}>
              去设置 <ArrowRight size={13} />
            </button>
          </div>
        ) : null}

        <div className="chat-scroll">
          {messages.length === 0 && !sending ? (
            <div className="ask-empty">
              <div className="ask-empty-mark">
                <span>问</span>
                <i />
              </div>
              <p className="eyebrow">A QUIET PLACE TO THINK</p>
              <h2>从书里来，<em>到问题里去。</em></h2>
              <p className="ask-empty-sub">
                选几本书作为上下文，问一个具体的问题。我会引用原文，而不是给你一个漂浮的答案。
              </p>
              <div className="suggestion-grid">
                {suggestions.map((item, index) => (
                  <button key={item} type="button" onClick={() => send(item)}>
                    <span className="suggestion-num">0{index + 1}</span>
                    <span>{item}</span>
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
              {!books.length ? (
                <button type="button" className="btn btn-primary" onClick={() => navigate('/library')}>
                  先去导入一本书
                </button>
              ) : null}
              {selectedBooks.length ? (
                <div className="ask-context-chips">
                  <span>本次范围</span>
                  {selectedBooks.map((book) => (
                    <span key={book.id} className="ask-chip">{truncate(book.title, 20)}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <div key={message.id} className={cx('message', `message-${message.role}`)}>
                  {message.role === 'user' ? (
                    <div className="user-message">
                      <p>{message.content}</p>
                    </div>
                  ) : (
                    <div className="assistant-message">
                      <div className="assistant-avatar">页</div>
                      <div className="assistant-body">
                        <div className="assistant-meta">
                          <span>页间</span>
                          <span className={cx('answer-mode', message.mode === 'ai' ? 'is-ai' : '')}>
                            {message.qaMode === 'free' ? '自由拓展' : '严格素材'} · {message.mode === 'ai' ? <><Sparkles size={11} /> AI 回答</> : '本地检索'}
                          </span>
                          <button type="button" className="copy-answer" onClick={() => copyAnswer(message)}>
                            {copiedId === message.id ? <Check size={13} /> : <Copy size={13} />}
                            {copiedId === message.id ? '已复制' : '复制'}
                          </button>
                        </div>
                        <Markdown content={message.content} />
                        <MessageSources sources={message.sources} onOpen={openSource} />
                        <WebSources
                          sources={message.webSources}
                          query={message.searchQuery}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending ? (
                <div className="message message-assistant">
                  <div className="assistant-message">
                    <div className="assistant-avatar">页</div>
                    <div className="assistant-body">
                      <div className="assistant-meta"><span>页间</span><span className="answer-mode">正在翻书</span></div>
                      <div className="typing-bubble">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <div className={cx('composer', sending && 'is-sending')}>
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
              placeholder={
                qaMode === 'free'
                  ? '问一个需要背景知识的问题…'
                  : aiReady
                    ? '针对原文提问、解读或出题…'
                    : '输入问题，先在原文里搜一搜…'
              }
              rows={1}
              disabled={sending}
            />
            <div className="composer-bar">
              <button
                type="button"
                className="composer-context"
                onClick={() => setContextOpen((value) => !value)}
              >
                <Database size={14} /> {contextLabel}
              </button>
              <span className="composer-hint">
                {draft.length > 0 ? `${draft.length} 字` : 'Enter 发送 · Shift + Enter 换行'}
              </span>
              <button
                type="button"
                className="send-btn"
                onClick={() => send()}
                disabled={!draft.trim() || sending || (qaMode === 'free' && !aiReady)}
                aria-label="发送问题"
              >
                {sending ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
              </button>
            </div>
          </div>
          <p className="composer-foot">
            回答会引用书库原文，仍建议回到原书核对上下文。
          </p>
        </div>
      </main>
    </div>
  );
}
