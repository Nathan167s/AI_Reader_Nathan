import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.PAGENEST_DATA_DIR
  ? path.resolve(process.env.PAGENEST_DATA_DIR)
  : path.join(ROOT, 'data');
export const BOOKS_DIR = path.join(DATA_DIR, 'books');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const ASSETS_DIR = path.join(DATA_DIR, 'assets');
export const NOTES_WORD_DIR = path.join(DATA_DIR, 'notes-word');
export const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
export const THREADS_FILE = path.join(DATA_DIR, 'threads.json');
export const MAPS_FILE = path.join(DATA_DIR, 'maps.json');
export const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
export const CONCEPTS_FILE = path.join(DATA_DIR, 'concepts.json');

export const DEFAULT_SETTINGS = {
  ai: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: '',
  },
  ui: {
    theme: 'paper',
  },
};

export async function ensureDirs() {
  await Promise.all(
    [DATA_DIR, BOOKS_DIR, FILES_DIR, ASSETS_DIR, NOTES_WORD_DIR].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  );
}

export function ensureDirsSync() {
  for (const dir of [DATA_DIR, BOOKS_DIR, FILES_DIR, ASSETS_DIR, NOTES_WORD_DIR]) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
}

const locks = new Map();

export function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  locks.set(key, run);
  return run.finally(() => {
    if (locks.get(key) === run) locks.delete(key);
  });
}

export async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    if (err instanceof SyntaxError) {
      console.warn(`[store] JSON 损坏，使用备用值: ${file}`);
      try {
        await fs.copyFile(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // 备份失败时仍继续使用备用值
      }
      return fallback;
    }
    throw err;
  }
}

export async function writeJson(file, data) {
  return withLock(`file:${file}`, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  });
}

export const newId = () => crypto.randomUUID();

export async function getLibrary() {
  const data = await readJson(LIBRARY_FILE, null);
  return Array.isArray(data) ? data : null;
}

export async function saveLibrary(books) {
  await writeJson(LIBRARY_FILE, books);
}

export async function getBookContent(id) {
  return readJson(path.join(BOOKS_DIR, `${id}.json`), null);
}

export async function saveBookContent(id, content) {
  await writeJson(path.join(BOOKS_DIR, `${id}.json`), content);
}

export async function deleteBookFiles(id) {
  await Promise.allSettled([
    fs.rm(path.join(BOOKS_DIR, `${id}.json`), { force: true }),
    fs.rm(path.join(ASSETS_DIR, id), { recursive: true, force: true }),
  ]);
  try {
    const files = await fs.readdir(FILES_DIR);
    await Promise.allSettled(
      files
        .filter((name) => name.startsWith(`${id}.`))
        .map((name) => fs.rm(path.join(FILES_DIR, name), { force: true })),
    );
  } catch {
    // 文件目录不存在时无需处理
  }
}

export async function getSettings() {
  const stored = await readJson(SETTINGS_FILE, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    ai: { ...DEFAULT_SETTINGS.ai, ...(stored.ai || {}) },
    ui: { ...DEFAULT_SETTINGS.ui, ...(stored.ui || {}) },
  };
}

export async function saveSettings(settings) {
  await writeJson(SETTINGS_FILE, settings);
}

export async function getThreads() {
  const data = await readJson(THREADS_FILE, []);
  return Array.isArray(data) ? data : [];
}

export async function saveThreads(threads) {
  await writeJson(THREADS_FILE, threads);
}

export async function getMaps() {
  const data = await readJson(MAPS_FILE, []);
  return Array.isArray(data) ? data : [];
}

export async function saveMaps(maps) {
  await writeJson(MAPS_FILE, maps);
}

export async function getNotesData() {
  const data = await readJson(NOTES_FILE, { items: [], analyses: {} });
  if (Array.isArray(data)) return { items: data, analyses: {} };
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    analyses: data?.analyses && typeof data.analyses === 'object' ? data.analyses : {},
  };
}

export async function saveNotesData(data) {
  await writeJson(NOTES_FILE, {
    items: Array.isArray(data?.items) ? data.items : [],
    analyses: data?.analyses && typeof data.analyses === 'object' ? data.analyses : {},
  });
}

export async function getConcepts() {
  const data = await readJson(CONCEPTS_FILE, []);
  return Array.isArray(data) ? data : [];
}

export async function saveConcepts(concepts) {
  await writeJson(CONCEPTS_FILE, concepts);
}

export function publicSettings(settings) {
  const envKey =
    process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
  const key = settings.ai.apiKey || envKey;
  return {
    ai: {
      provider: settings.ai.provider,
      baseUrl:
        settings.ai.baseUrl ||
        (process.env.OPENAI_API_KEY
          ? 'https://api.openai.com/v1'
          : DEFAULT_SETTINGS.ai.baseUrl),
      model: settings.ai.model,
      configured: Boolean(key),
      keyPreview: key
        ? `${key.slice(0, 3)}••••${key.slice(-3)}`
        : '',
      source: settings.ai.apiKey ? 'local' : envKey ? 'env' : 'none',
    },
    ui: settings.ui,
  };
}

export function bookFilePath(book) {
  if (!book?.sourceFile) return null;
  const resolved = path.join(FILES_DIR, path.basename(book.sourceFile));
  return resolved.startsWith(FILES_DIR) ? resolved : null;
}
