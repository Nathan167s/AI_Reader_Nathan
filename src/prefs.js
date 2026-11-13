const KEY = 'pagenest.prefs.v1';

export const DEFAULT_PREFS = {
  fontSize: 19,
  lineHeight: 2,
  width: 720,
  theme: 'dark',
  readingMode: 'scroll',
};

export const READER_THEMES = [
  { id: 'paper', name: '墨纸', color: '#151a17', ink: '#e8e2d5' },
  { id: 'white', name: '冷灰', color: '#111516', ink: '#e4ebe8' },
  { id: 'sepia', name: '暖夜', color: '#18130e', ink: '#ead8be' },
  { id: 'dark', name: '深林', color: '#0c1210', ink: '#dbe8df' },
];

export function loadPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      ...DEFAULT_PREFS,
      ...stored,
      fontSize: Math.min(26, Math.max(15, Number(stored.fontSize) || DEFAULT_PREFS.fontSize)),
      lineHeight: Math.min(2.4, Math.max(1.5, Number(stored.lineHeight) || DEFAULT_PREFS.lineHeight)),
      width: Math.min(900, Math.max(580, Number(stored.width) || DEFAULT_PREFS.width)),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function persistPrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 本地存储不可用时仍保持当前会话设置
  }
}
