import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardPaste,
  FileText,
  Link2,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { cx } from '../utils.js';

const TABS = [
  { id: 'file', label: '文件', icon: UploadCloud },
  { id: 'url', label: '网页链接', icon: Link2 },
  { id: 'paste', label: '粘贴正文', icon: ClipboardPaste },
];

const STATUS_TEXT = {
  wait: '等待中',
  uploading: '正在解析',
  done: '已导入',
  error: '失败',
};

export default function ImportDialog({ open, onClose, onImported }) {
  const [tab, setTab] = useState('file');
  const [queue, setQueue] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [url, setUrl] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const inputRef = useRef(null);
  const pasteRef = useRef(null);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTab('file');
    setQueue([]);
    setBusy(false);
    setError(null);
    setUrl('');
    setPasteTitle('');
    setPasteContent('');
    setTimeout(() => inputRef.current?.focus(), 180);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (tab === 'url') setTimeout(() => urlRef.current?.focus(), 120);
    if (tab === 'paste') setTimeout(() => pasteRef.current?.focus(), 120);
  }, [tab, open]);

  const finish = (book) => {
    if (!book) return;
    setTimeout(() => onImported?.(book), 620);
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || busy) return;
    setError(null);
    const items = files.map((file) => ({ file, status: 'wait', message: '' }));
    setQueue(items);
    setBusy(true);
    let lastBook = null;
    for (let index = 0; index < items.length; index += 1) {
      setQueue((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, status: 'uploading' } : item,
        ),
      );
      try {
        const result = await api.uploadBook(items[index].file);
        lastBook = result.book;
        setQueue((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'done' } : item,
          ),
        );
      } catch (err) {
        setQueue((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, status: 'error', message: err.message }
              : item,
          ),
        );
        setError({ message: err.message, code: err.code });
      }
    }
    setBusy(false);
    if (lastBook) finish(lastBook);
  };

  const handleUrl = async (event) => {
    event.preventDefault();
    if (busy) return;
    let value = url.trim();
    if (!value) {
      setError({ message: '请粘贴文章链接' });
      return;
    }
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importUrl(value);
      finish(result.book);
    } catch (err) {
      setError({ message: err.message, code: err.code });
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!pasteContent.trim()) {
      setError({ message: '请先粘贴正文内容' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.importPaste({
        content: pasteContent,
        title: pasteTitle.trim(),
        html: /<\/?[a-z][\s\S]*>/i.test(pasteContent),
      });
      finish(result.book);
    } catch (err) {
      setError({ message: err.message, code: err.code });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose?.();
      }}
      eyebrow="ADD TO YOUR SHELF"
      title="把想读的，放上书架"
      width={760}
      className="import-modal"
      closeOnBackdrop={!busy}
    >
      <div className="import-tabs" role="tablist">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={cx('import-tab', tab === item.id && 'is-active')}
              onClick={() => setTab(item.id)}
              disabled={busy}
            >
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'file' ? (
        <div className="import-pane">
          <div
            className={cx('dropzone', dragging && 'is-dragging', busy && 'is-busy')}
            onClick={() => !busy && inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.pdf,.docx,.doc,.html,.htm,.epub"
              hidden
              onChange={(event) => {
                handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <div className="dropzone-art">
              <span className="drop-ring ring-one" />
              <span className="drop-ring ring-two" />
              <UploadCloud size={30} strokeWidth={1.5} />
            </div>
            <h3>{busy ? '正在整理书页…' : '拖放文件到这里，或点击选择'}</h3>
            <p>TXT · Markdown · PDF · Word · HTML · EPUB</p>
            <span className="drop-limit">单个文件最大 60MB</span>
          </div>

          {queue.length ? (
            <div className="import-queue">
              {queue.map((item, index) => (
                <div className={cx('queue-item', `is-${item.status}`)} key={`${item.file.name}-${index}`}>
                  <span className="queue-icon"><FileText size={17} /></span>
                  <div className="queue-main">
                    <strong>{item.file.name}</strong>
                    <span>
                      {item.status === 'error'
                        ? item.message
                        : `${(item.file.size / 1024 / 1024).toFixed(1)} MB · ${STATUS_TEXT[item.status]}`}
                    </span>
                  </div>
                  <span className="queue-state">
                    {item.status === 'uploading' ? <Loader2 size={17} className="spin" /> : null}
                    {item.status === 'done' ? <Check size={17} /> : null}
                    {item.status === 'error' ? <AlertCircle size={17} /> : null}
                    {item.status === 'wait' ? <span className="queue-wait" /> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'url' ? (
        <form className="import-pane" onSubmit={handleUrl}>
          <div className="field">
            <label htmlFor="import-url">文章链接</label>
            <div className="input-with-icon">
              <Link2 size={17} />
              <input
                id="import-url"
                ref={urlRef}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://mp.weixin.qq.com/s/..."
                disabled={busy}
                spellCheck={false}
              />
            </div>
            <p className="field-hint">
              支持微信公众号文章与普通网页。微信若提示“环境异常”，请打开文章复制全文，再用「粘贴正文」。
            </p>
          </div>
          <div className="import-note">
            <BookOpen size={18} />
            <div>
              <strong>会把网页整理成干净的阅读版</strong>
              <span>自动提取标题、作者与正文，图片下载到本地，之后断网也能读。</span>
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-lg import-submit" disabled={busy}>
            {busy ? <><Loader2 size={17} className="spin" /> 正在抓取正文…</> : <>导入到书架 <ArrowRight size={17} /></>}
          </button>
        </form>
      ) : null}

      {tab === 'paste' ? (
        <form className="import-pane" onSubmit={handlePaste}>
          <div className="field">
            <label htmlFor="paste-title">标题 <span>可选</span></label>
            <input
              id="paste-title"
              value={pasteTitle}
              onChange={(event) => setPasteTitle(event.target.value)}
              placeholder="给这篇文章起个名字"
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="paste-content">正文</label>
            <textarea
              id="paste-content"
              ref={pasteRef}
              value={pasteContent}
              onChange={(event) => setPasteContent(event.target.value)}
              placeholder="粘贴文章正文，或从网页复制的 HTML 源码。"
              rows={9}
              disabled={busy}
            />
            <p className="field-hint">支持纯文本和 HTML，会自动识别段落与小标题。</p>
          </div>
          <button type="submit" className="btn btn-primary btn-lg import-submit" disabled={busy}>
            {busy ? <><Loader2 size={17} className="spin" /> 正在整理…</> : <>保存到书架 <ArrowRight size={17} /></>}
          </button>
        </form>
      ) : null}

      {error ? (
        <div className="import-error">
          <AlertCircle size={18} />
          <div>
            <strong>{error.code === 'WECHAT_BLOCKED' ? '微信拦截了这次访问' : '这次没有导入成功'}</strong>
            <span>{error.message}</span>
            {error.code === 'WECHAT_BLOCKED' ? (
              <button type="button" className="text-link" onClick={() => setTab('paste')}>
                改用「粘贴正文」导入 <ArrowRight size={14} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <footer className="import-foot">
        <span><Check size={13} /> 文件只保存在这台电脑</span>
        <span>支持 TXT / PDF / Word / HTML / EPUB / 微信文章</span>
      </footer>
    </Modal>
  );
}
