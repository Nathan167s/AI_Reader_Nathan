import {
  LibraryBig,
  MessageCircleQuestion,
  Network,
  Plus,
  Settings,
  Sparkles,
  TreePine,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { navigate } from '../utils.js';

const NAV = [
  { id: 'library', label: '书架', icon: LibraryBig, path: '/library' },
  { id: 'ask', label: '问答', icon: MessageCircleQuestion, path: '/ask' },
  { id: 'maps', label: '导图', icon: Network, path: '/maps' },
  { id: 'concepts', label: '概念', icon: TreePine, path: '/concepts' },
];

export default function Sidebar({ current }) {
  const { setImportOpen, settings } = useApp();
  const active = current === 'reader' ? 'library' : current;
  return (
    <aside className="sidebar">
      <button
        type="button"
        className="brand"
        onClick={() => navigate('/library')}
        aria-label="页间首页"
      >
        <span className="brand-glyph">页</span>
        <span className="brand-word">页间</span>
      </button>

      <nav className="side-nav" aria-label="主导航">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`side-link ${active === item.id ? 'is-active' : ''}`}
              onClick={() => navigate(item.path)}
              title={item.label}
            >
              <span className="side-icon"><Icon size={20} strokeWidth={1.8} /></span>
              <span className="side-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="side-bottom">
        <button
          type="button"
          className="side-import"
          onClick={() => setImportOpen(true)}
          title="导入书籍或网页"
        >
          <Plus size={20} strokeWidth={1.9} />
          <span>导入</span>
        </button>
        <button
          type="button"
          className={`side-link side-settings ${active === 'settings' ? 'is-active' : ''}`}
          onClick={() => navigate('/settings')}
          title="设置"
        >
          <span className="side-icon"><Settings size={20} strokeWidth={1.8} /></span>
          <span className="side-label">设置</span>
        </button>
        <div className="local-badge" title="所有数据都保存在本机">
          <span className="local-pulse" />
          <span>本地</span>
          {settings?.ai?.configured ? (
            <Sparkles size={12} className="ai-spark" />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
