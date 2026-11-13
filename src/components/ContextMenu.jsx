import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Copy,
  Globe2,
  LibraryBig,
  MessageCircleQuestion,
  Search,
  StickyNote,
} from 'lucide-react';
import { truncate } from '../utils.js';

const WEB_SEARCHES = [
  { id: 'bing', label: '必应', url: 'https://www.bing.com/search?q=' },
  { id: 'baidu', label: '百度', url: 'https://www.baidu.com/s?wd=' },
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q=' },
];

export default function ContextMenu({
  menu,
  onClose,
  onSearchBook,
  onSearchLibrary,
  onAsk,
  onNote,
  onCopy,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      Math.max(margin, menu.x),
      window.innerWidth - rect.width - margin,
    );
    const top = Math.min(
      Math.max(margin, menu.y),
      window.innerHeight - rect.height - margin,
    );
    setPos({ left, top });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) onClose?.();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    const onScroll = () => onClose?.();
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const openWeb = (base) => {
    window.open(`${base}${encodeURIComponent(menu.text)}`, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      style={pos}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-quote">“{truncate(menu.text, 82)}”</div>
      <div className="context-section">
        <button type="button" role="menuitem" onClick={() => { onSearchBook?.(menu.text); onClose(); }}>
          <Search size={15} />
          <span>在本书中搜索</span>
          <kbd>⌘F</kbd>
        </button>
        <button type="button" role="menuitem" onClick={() => { onSearchLibrary?.(menu.text); onClose(); }}>
          <LibraryBig size={15} />
          <span>在书库中搜索</span>
        </button>
      </div>
      <div className="context-section">
        <p className="context-label"><Globe2 size={13} /> 网页搜索</p>
        <div className="web-search-row">
          {WEB_SEARCHES.map((item) => (
            <button key={item.id} type="button" role="menuitem" onClick={() => openWeb(item.url)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="context-section">
        <button type="button" role="menuitem" onClick={() => { onAsk?.(menu.text); onClose(); }}>
          <MessageCircleQuestion size={15} />
          <span>就这段内容提问</span>
          <span className="context-accent">AI</span>
        </button>
        <button type="button" role="menuitem" onClick={() => { onNote?.(menu.text); onClose(); }}>
          <StickyNote size={15} />
          <span>保存为笔记</span>
        </button>
        <button type="button" role="menuitem" onClick={() => { onCopy?.(menu.text); onClose(); }}>
          <Copy size={15} />
          <span>复制选中内容</span>
          <kbd>⌘C</kbd>
        </button>
      </div>
      <div className="context-foot">
        <BookOpen size={12} />
        右键快捷搜索 · 选中文字也可以
      </div>
    </div>
  );
}
