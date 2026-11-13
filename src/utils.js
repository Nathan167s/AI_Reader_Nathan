export const FORMAT_LABELS = {
  txt: 'TXT',
  md: 'MD',
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOC',
  html: 'HTML',
  web: '网页',
  epub: 'EPUB',
};

export const FORMAT_NAMES = {
  txt: '文本',
  md: 'Markdown',
  pdf: 'PDF',
  docx: 'Word',
  doc: 'Word',
  html: '网页',
  web: '网页',
  epub: 'EPUB',
};

export const PALETTES = [
  { id: 'forest', bg: '#274439', ink: '#efe7d6', accent: '#b8c7a8', glow: '#78947a', label: '松林' },
  { id: 'clay', bg: '#853f30', ink: '#f4e5d6', accent: '#e2a881', glow: '#c87551', label: '陶土' },
  { id: 'indigo', bg: '#283b59', ink: '#e7ebf2', accent: '#9eb0d0', glow: '#6f83aa', label: '靛蓝' },
  { id: 'ochre', bg: '#7f5a26', ink: '#f6ead2', accent: '#e3c27e', glow: '#c69b4c', label: '赭石' },
  { id: 'plum', bg: '#553246', ink: '#f3e4ea', accent: '#d3a2b6', glow: '#a26c82', label: '梅子' },
  { id: 'slate', bg: '#354248', ink: '#e9eeec', accent: '#a9bcb8', glow: '#728b87', label: '青灰' },
];

export const MAP_THEMES = {
  forest: {
    name: '松林',
    accent: '#3f6a58',
    root: '#223c33',
    rootInk: '#f4efe3',
    branch: ['#4b7a63', '#8a6a3e', '#526c82', '#8a5144'],
    line: '#9caf9f',
    paper: '#f7f3e9',
  },
  clay: {
    name: '陶土',
    accent: '#a5563f',
    root: '#773d2e',
    rootInk: '#fbede1',
    branch: ['#b66549', '#8f6a42', '#5e7568', '#6a5879'],
    line: '#c8a38e',
    paper: '#f8f0e8',
  },
  ocean: {
    name: '海岬',
    accent: '#35687a',
    root: '#244956',
    rootInk: '#edf6f7',
    branch: ['#3d798a', '#5b7f76', '#5f6f96', '#8a7048'],
    line: '#92b6bd',
    paper: '#f1f5f4',
  },
  plum: {
    name: '梅笺',
    accent: '#83506a',
    root: '#553147',
    rootInk: '#f8ebf1',
    branch: ['#9b6680', '#6e6f8c', '#7b6b4d', '#55756a'],
    line: '#c4a4b3',
    paper: '#f8f1f2',
  },
};

export function cx(...values) {
  return values.filter(Boolean).join(' ');
}

export function hashString(value = '') {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.codePointAt(0)) % 100000;
  return hash;
}

export function paletteFor(book) {
  return PALETTES[(book?.palette ?? hashString(book?.title || '')) % PALETTES.length];
}

export function formatDate(value, withTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const options = sameYear
    ? { month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

export function relativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatDate(value);
}

export function formatNumber(value = 0) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)} 亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function readingMinutes(words = 0) {
  return Math.max(1, Math.round(words / 400));
}

export function progressPercent(book) {
  const progress = book?.progress || {};
  const chapter = Number(progress.chapterIndex) || 0;
  const ratio = Number(progress.ratio) || 0;
  const count = Math.max(1, book?.chapterCount || 1);
  if (book?.format === 'pdf' && progress.page && count) {
    return Math.min(100, Math.max(0, ((Number(progress.page) - 1 + ratio) / count) * 100));
  }
  return Math.min(100, Math.max(0, ((chapter + ratio) / count) * 100));
}

export function truncate(value = '', length = 80) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type }), filename);
}

export function safeFilename(value = 'download') {
  return String(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function uid(prefix = 'n') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseRoute(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/library';
  const [pathPart, queryString = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  return {
    path: `/${parts.join('/')}`,
    parts,
    query: new URLSearchParams(queryString),
  };
}

export function navigate(to, options = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (options.replace) window.location.replace(target);
  else window.location.hash = target.replace(/^#/, '');
}

export function segmentText(text = '', max = 28) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
