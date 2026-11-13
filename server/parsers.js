import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import iconv from 'iconv-lite';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import JSZip from 'jszip';
import { marked } from 'marked';
import { ASSETS_DIR } from './store.js';

const BLOCK_END = /<\/(p|div|section|article|h[1-6]|li|blockquote|tr|pre|figcaption|table)>/gi;
const BR = /<br\s*\/?>/gi;

export class ImportError extends Error {
  constructor(message, code = 'IMPORT_FAILED', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeText(value = '') {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeText(buffer) {
  if (!buffer?.length) return '';
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer.subarray(2), 'utf16-le');
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer.subarray(2), 'utf16-be');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, 'gb18030');
  }
}

export function htmlToText(html = '') {
  const withBreaks = String(html)
    .replace(BR, '\n')
    .replace(BLOCK_END, '\n');
  const $ = cheerio.load(`<body>${withBreaks}</body>`);
  $('script,style,noscript').remove();
  return normalizeText($('body').text().replace(/\u200b/g, ''));
}

export function countWords(text = '') {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + latin;
}

export function cleanTitle(value = '', fallback = '未命名') {
  let title = String(value || '')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  title = title
    .replace(/[_|｜-]\s*(微信公众号|微信公众平台|知乎|简书|豆瓣|新浪新闻|澎湃新闻)$/i, '')
    .replace(/\.(txt|md|markdown|pdf|docx?|html?|epub)$/i, '')
    .trim();
  return (title || fallback).slice(0, 120);
}

function chunkHtml(html, fallbackTitle) {
  const $ = cheerio.load(`<body>${html}</body>`);
  const chunks = [];
  let current = '';
  let index = 0;
  const push = () => {
    const text = htmlToText(current);
    if (!text) {
      current = '';
      return;
    }
    index += 1;
    chunks.push({
      title: index === 1 ? fallbackTitle : `第 ${index} 节`,
      html: current,
      text,
    });
    current = '';
  };

  $('body')
    .children()
    .each((_, el) => {
      const piece = $.html(el);
      const textLength = htmlToText(piece).length;
      if (current && htmlToText(current).length + textLength > 16000) push();
      current += piece;
      if (textLength > 16000) push();
    });
  push();
  return chunks;
}

export function splitHtmlIntoChapters(rawHtml, fallbackTitle = '正文') {
  const html = sanitizeContentHtml(rawHtml);
  const $ = cheerio.load(`<body>${html}</body>`);
  const body = $('body');
  const headingNodes = body.find('h1,h2').filter((_, el) => {
    const text = $(el).text().trim();
    return text.length > 0 && text.length <= 80;
  });

  if (headingNodes.length < 2) {
    const chunks = chunkHtml(body.html() || html, fallbackTitle);
    return chunks.length ? chunks : [{ title: fallbackTitle, html: '', text: '' }];
  }

  const chapters = [];
  let current = { title: fallbackTitle, parts: [], started: false };

  const flush = () => {
    const chapterHtml = current.parts.join('');
    const text = htmlToText(chapterHtml);
    if (text || chapters.length === 0) {
      chapters.push({
        title: cleanTitle(current.title, fallbackTitle),
        html: chapterHtml,
        text,
      });
    }
    current = { title: '', parts: [], started: true };
  };

  body.children().each((_, el) => {
    const tag = (el.tagName || '').toLowerCase();
    const text = $(el).text().trim();
    if ((tag === 'h1' || tag === 'h2') && text && text.length <= 80) {
      if (current.parts.length || chapters.length) flush();
      current.title = text;
      current.parts = [];
      return;
    }
    current.parts.push($.html(el));
  });
  flush();

  const cleaned = chapters
    .map((chapter) => ({
      ...chapter,
      text: normalizeText(chapter.text),
      html: chapter.html || `<p>${escapeHtml(chapter.text)}</p>`,
    }))
    .filter((chapter) => chapter.text || chapter.html);
  return cleaned.length ? cleaned : [{ title: fallbackTitle, html, text: htmlToText(html) }];
}

export function sanitizeContentHtml(rawHtml = '') {
  return sanitizeHtml(String(rawHtml), {
    allowedTags: [
      'p', 'br', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
      'code', 'pre', 'img', 'figure', 'figcaption', 'a', 'hr', 'table', 'thead',
      'tbody', 'tfoot', 'tr', 'th', 'td', 'span', 'sup', 'sub', 'mark', 'small',
      'ruby', 'rt', 'rp', 'dl', 'dt', 'dd', 'caption', 'colgroup', 'col',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'referrerpolicy'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      col: ['span'],
      '*': ['id'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
        },
      }),
    },
  });
}

function makeChapter(title, html, text) {
  return {
    title: cleanTitle(title, '正文'),
    html: html || `<p>${escapeHtml(text || '')}</p>`,
    text: normalizeText(text || htmlToText(html)),
  };
}

export function finalizeContent({
  title,
  author = '',
  format,
  chapters,
  sourceUrl = '',
  sourceType = 'upload',
  meta = {},
}) {
  const normalized = (chapters || [])
    .map((chapter, index) => {
      const safeHtml = sanitizeContentHtml(
        chapter.html || `<p>${escapeHtml(chapter.text || '')}</p>`,
      );
      const fromHtml = htmlToText(safeHtml);
      return {
        id: `c${index + 1}`,
        title: cleanTitle(chapter.title, index ? `第 ${index + 1} 节` : '正文'),
        html: safeHtml,
        text: normalizeText(fromHtml || chapter.text),
      };
    })
    .filter((chapter) => chapter.text.length > 0 || htmlToText(chapter.html).length > 0);
  const finalChapters = normalized.length
    ? normalized
    : [makeChapter('正文', '<p></p>', '')];
  const text = finalChapters.map((chapter) => chapter.text).join('\n\n');
  const excerpt = text.replace(/\s+/g, ' ').slice(0, 140);
  return {
    title: cleanTitle(title),
    author: String(author || '').trim().slice(0, 80),
    format,
    sourceType,
    sourceUrl,
    excerpt,
    text,
    wordCount: countWords(text),
    chapters: finalChapters,
    meta,
  };
}

/* ------------------------------------------------------------------ */
/* 纯文本 / Markdown                                                    */
/* ------------------------------------------------------------------ */

const HEADING_RE = /^(第[0-9零一二三四五六七八九十百千万两]+[章回节卷部篇](?:[\s：:、.．].{0,42}|.{0,42})|(?:序章|序言|前言|楔子|引子|后记|尾声|终章)(?:[\s：:、.．].{0,30})?|Chapter\s+[0-9IVXLC]+(?:\s*[:：.\-]\s*.{0,40})?)$/i;
const MD_HEADING_RE = /^#{1,3}\s+(.+)$/;

function detectHeadings(lines) {
  const found = [];
  lines.forEach((line, index) => {
    const value = line.trim();
    if (!value || value.length > 56) return;
    if (HEADING_RE.test(value) || MD_HEADING_RE.test(value)) {
      found.push({ index, title: value.replace(MD_HEADING_RE, '$1').trim() });
    }
  });
  return found;
}

function paragraphsToHtml(lines) {
  const parts = [];
  let buffer = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      parts.push(`<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`);
    }
    buffer = [];
  };
  for (const line of lines) {
    if (!line.trim()) flush();
    else buffer.push(line);
  }
  flush();
  return parts.join('\n');
}

function splitLongText(text, title) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const chapters = [];
  let bucket = [];
  let length = 0;
  let index = 0;
  const push = () => {
    if (!bucket.length) return;
    index += 1;
    chapters.push(
      makeChapter(
        index === 1 ? title : `第 ${index} 节`,
        paragraphsToHtml(bucket.join('\n\n').split('\n')),
        bucket.join('\n\n'),
      ),
    );
    bucket = [];
    length = 0;
  };
  for (const paragraph of paragraphs) {
    if (length && length + paragraph.length > 18000) push();
    bucket.push(paragraph);
    length += paragraph.length;
  }
  push();
  return chapters.length ? chapters : [makeChapter(title, '', '')];
}

export function parseText(buffer, filename = '未命名') {
  const raw = normalizeText(decodeText(buffer));
  const title = cleanTitle(filename, '未命名');
  const lines = raw.split('\n');
  const headings = detectHeadings(lines);

  if (headings.length >= 2) {
    const chapters = [];
    const preface = lines.slice(0, headings[0].index);
    if (preface.join('').trim().length > 20) {
      chapters.push(
        makeChapter('序', paragraphsToHtml(preface), normalizeText(preface.join('\n'))),
      );
    }
    headings.forEach((heading, i) => {
      const end = i + 1 < headings.length ? headings[i + 1].index : lines.length;
      const bodyLines = lines.slice(heading.index + 1, end);
      chapters.push(
        makeChapter(
          heading.title,
          paragraphsToHtml(bodyLines),
          normalizeText(bodyLines.join('\n')),
        ),
      );
    });
    return finalizeContent({
      title,
      format: 'txt',
      chapters,
      meta: { encoding: 'auto' },
    });
  }

  const chapters = splitLongText(raw, title);
  return finalizeContent({
    title,
    format: 'txt',
    chapters,
    meta: { encoding: 'auto' },
  });
}

export function parseMarkdown(buffer, filename = '未命名') {
  const raw = decodeText(buffer);
  const title = cleanTitle(filename, '未命名');
  const html = marked.parse(raw, { gfm: true, breaks: false });
  const chapters = splitHtmlIntoChapters(html, title);
  return finalizeContent({ title, format: 'md', chapters });
}

/* ------------------------------------------------------------------ */
/* Word / PDF                                                           */
/* ------------------------------------------------------------------ */

async function readOfficeMeta(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const core = zip.file('docProps/core.xml');
    if (!core) return {};
    const xml = await core.async('string');
    const pick = (tag) => {
      const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      if (!match) return '';
      return cheerio.load(`<x>${match[1]}</x>`, { xmlMode: true })('x').text().trim();
    };
    return {
      title: pick('dc:title'),
      author: pick('dc:creator'),
    };
  } catch {
    return {};
  }
}

export async function parseDocx(buffer, filename = '未命名') {
  const office = await readOfficeMeta(buffer);
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='标题'] => h1:fresh",
        "p[style-name='副标题'] => h2:fresh",
      ],
    },
  );
  const html = sanitizeContentHtml(result.value);
  const title = cleanTitle(office.title || filename, '未命名');
  const chapters = splitHtmlIntoChapters(html, title);
  return finalizeContent({
    title,
    author: office.author,
    format: 'docx',
    chapters,
    meta: { warnings: result.messages.slice(0, 5).map((m) => m.message) },
  });
}

export async function parseDoc(buffer, filename = '未命名') {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  const text = normalizeText(doc.getBody() || doc.getText() || '');
  const title = cleanTitle(doc.getTitle?.() || filename, '未命名');
  const chapters = splitLongText(text, title);
  return finalizeContent({
    title,
    author: doc.getAuthor?.() || '',
    format: 'doc',
    chapters,
  });
}

function pdfTextFromItems(items) {
  let out = '';
  let lastX = null;
  let lastY = null;
  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) out += '\n';
      continue;
    }
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 3) out += '\n';
    else if (lastX !== null && x - lastX > 12 && out && !out.endsWith('\n')) out += ' ';
    out += item.str;
    lastX = x + (item.width || 0);
    lastY = y;
    if (item.hasEOL) out += '\n';
  }
  return normalizeText(
    out
      .replace(/[ \t]+\n/g, '\n')
      .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2'),
  );
}

export async function parsePdf(buffer, filename = '未命名') {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    let meta = {};
    try {
      const info = await doc.getMetadata();
      meta = info?.info || {};
    } catch {
      meta = {};
    }
    if (doc.numPages > 1200) {
      throw new ImportError('PDF 页数过多（超过 1200 页）', 'PDF_TOO_LARGE');
    }
    const chapters = [];
    const pageTexts = [];
    let textPages = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pdfTextFromItems(content.items);
      if (text.trim()) textPages += 1;
      pageTexts.push(text);
      chapters.push(
        makeChapter(`第 ${pageNumber} 页`, '', text || '（此页没有可提取的文字，可能是扫描图片）'),
      );
      page.cleanup();
    }
    return finalizeContent({
      title: cleanTitle(meta.Title || filename, '未命名'),
      author: meta.Author || '',
      format: 'pdf',
      chapters,
      meta: {
        pages: doc.numPages,
        pageTexts,
        textPages,
        producer: meta.Producer || '',
      },
    });
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* HTML / 网页                                                          */
/* ------------------------------------------------------------------ */

function absolutize(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function pickArticleRoot($) {
  const candidates = [];
  const selectors = [
    '#js_content',
    'article',
    '[role="main"]',
    'main',
    '.article-content',
    '.article_content',
    '.post-content',
    '.post_content',
    '.entry-content',
    '.rich_media_content',
    '#content',
    '.content',
  ];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const length = $(el).text().replace(/\s+/g, '').length;
      if (length > 120) candidates.push({ el, length, priority: selector === '#js_content' ? 2 : 1 });
    });
  }
  $('div,section').each((_, el) => {
    const className = String($(el).attr('class') || '');
    if (!/(article|content|post|entry|rich_media)/i.test(className)) return;
    const length = $(el).text().replace(/\s+/g, '').length;
    if (length > 500) candidates.push({ el, length, priority: 0 });
  });
  if (!candidates.length) return $('body');
  candidates.sort((a, b) => b.priority - a.priority || b.length - a.length);
  return $(candidates[0].el);
}

function cleanArticleDom($, root) {
  const scope = root ? $(root) : $('body');
  scope.find('script,style,noscript,iframe,form,button,input,select,textarea,svg,canvas,video,audio,object,embed').remove();
  scope.find(
    'header,footer,nav,aside,.qr_code_pc,.rich_media_tool,.share_notice,.comment,.comments,.sidebar,.advertisement,.ad,.ads,.recommend,.related,.toolbar,.breadcrumb,.pagination,.subscribe,.reward,.follow',
  ).remove();
  scope.find('*').contents().filter((_, node) => node.type === 'comment').remove();
  scope.find('[style]').removeAttr('style');
  scope.find('[class]').removeAttr('class');
  scope.find('[id]').removeAttr('id');
  scope.find('[onclick],[onload],[onerror]').each((_, el) => {
    $(el).removeAttr('onclick').removeAttr('onload').removeAttr('onerror');
  });
}

function extractMeta($, url) {
  const meta = (name) =>
    $(`meta[property="${name}"],meta[name="${name}"]`).attr('content') || '';
  let title =
    $('#activity-name').text().trim() ||
    meta('og:title') ||
    meta('twitter:title') ||
    $('h1').first().text().trim() ||
    $('title').text().trim();
  title = cleanTitle(title, '网页文章');
  const author =
    $('#js_name').text().trim() ||
    meta('author') ||
    meta('article:author') ||
    $('.author').first().text().trim() ||
    '';
  const published =
    $('#publish_time').text().trim() ||
    meta('article:published_time') ||
    meta('pubdate') ||
    '';
  return {
    title,
    author: author.replace(/\s+/g, ' ').slice(0, 80),
    published,
    description: meta('description') || meta('og:description') || '',
    site: meta('og:site_name') || new URL(url).hostname,
  };
}

const IMAGE_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index).catch(() => null);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function cacheArticleImages(html, baseUrl, { bookId, referer }) {
  const $ = cheerio.load(`<body>${html}</body>`);
  const images = $('img').toArray().slice(0, 40);
  await mapLimit(images, 4, async (el) => {
    const $img = $(el);
    const raw =
      $img.attr('data-src') ||
      $img.attr('data-original') ||
      $img.attr('data-lazy-src') ||
      $img.attr('src') ||
      '';
    if (!raw || raw.startsWith('data:')) return;
    const src = absolutize(raw, baseUrl);
    if (!/^https?:/i.test(src)) return;
    $img.attr('src', src);
    try {
      const safe = await assertPublicUrl(src);
      const { response } = await fetchPublic(safe, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Referer: referer || baseUrl,
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return;
      const type = (response.headers.get('content-type') || '').split(';')[0].trim();
      const ext = IMAGE_EXT[type];
      if (!ext) return;
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 8 * 1024 * 1024) return;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 8 * 1024 * 1024) return;
      const name = `${crypto.createHash('sha1').update(src).digest('hex').slice(0, 16)}.${ext}`;
      const dir = path.join(ASSETS_DIR, bookId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, name), data);
      $img.attr('src', `/assets/${bookId}/${name}`);
    } catch (err) {
      if (['URL_NOT_ALLOWED', 'URL_UNRESOLVED'].includes(err.code)) $img.remove();
    }
  });
  return $('body').html() || html;
}

function decodeResponseBuffer(buffer, contentType = '') {
  const match = /charset=([^;]+)/i.exec(contentType);
  if (match) {
    const charset = match[1].trim().replace(/["']/g, '').toLowerCase();
    try {
      if (!['utf-8', 'utf8'].includes(charset)) return iconv.decode(buffer, charset);
    } catch {
      // 继续使用自动检测
    }
  }
  return decodeText(buffer);
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) {
    const value = address.toLowerCase();
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fe80:') || value.startsWith('ff')) return true;
    if (value.startsWith('fc') || value.startsWith('fd')) return true;
    if (value.startsWith('::ffff:')) return true;
    return false;
  }
  return true;
}

const dnsCheckCache = new Map();

export async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl.toString()) : new URL(rawUrl);
  } catch {
    throw new ImportError('请输入完整的网页地址（以 http:// 或 https:// 开头）', 'INVALID_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ImportError('只支持 http 或 https 网页地址', 'INVALID_URL');
  }
  const host = url.hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!host) {
    throw new ImportError('网页地址缺少域名', 'INVALID_URL');
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (!host.includes('.') && net.isIP(host) === 0)
  ) {
    throw new ImportError('为安全起见，不能导入本机或内网地址', 'URL_NOT_ALLOWED');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new ImportError('为安全起见，不能导入本机或内网地址', 'URL_NOT_ALLOWED');
    }
    return url;
  }
  const cached = dnsCheckCache.get(host);
  if (cached && Date.now() - cached.at < 60000) {
    if (!cached.safe) {
      throw new ImportError('为安全起见，不能导入本机或内网地址', 'URL_NOT_ALLOWED');
    }
    return url;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ImportError('无法解析这个域名，请检查链接是否正确', 'URL_UNRESOLVED', 400);
  }
  const safe = records.length > 0 && records.every((record) => !isPrivateAddress(record.address));
  dnsCheckCache.set(host, { safe, at: Date.now() });
  if (!safe) {
    throw new ImportError('为安全起见，不能导入本机或内网地址', 'URL_NOT_ALLOWED');
  }
  return url;
}

async function fetchPublic(rawUrl, options = {}, maxRedirects = 4) {
  let current = await assertPublicUrl(rawUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(current, { ...options, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { response, url: current };
      await response.body?.cancel().catch(() => {});
      const next = new URL(location, current).toString();
      current = await assertPublicUrl(next);
      continue;
    }
    return { response, url: current };
  }
  throw new ImportError('网页重定向次数过多，无法导入', 'TOO_MANY_REDIRECTS', 400);
}

export async function importWebArticle(rawUrl, { bookId } = {}) {
  let url = await assertPublicUrl(String(rawUrl || '').trim());
  let response;
  let finalUrl;
  try {
    const result = await fetchPublic(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 MicroMessenger/8.0.50',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
      signal: AbortSignal.timeout(25000),
    });
    response = result.response;
    finalUrl = result.url.toString();
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(
      `网页请求失败：${err.name === 'TimeoutError' ? '请求超时，请稍后重试' : err.message}`,
      'FETCH_FAILED',
      502,
    );
  }
  if (!response.ok) {
    throw new ImportError(`网页返回 ${response.status}，无法读取内容`, 'FETCH_FAILED', 502);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw new ImportError('这个地址不是网页正文', 'UNSUPPORTED_PAGE');
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 15 * 1024 * 1024) {
    throw new ImportError('网页内容过大，请使用「粘贴正文」导入', 'TOO_LARGE');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) {
    throw new ImportError('网页内容过大，请使用「粘贴正文」导入', 'TOO_LARGE');
  }
  const html = decodeResponseBuffer(buffer, contentType);

  if (/mp\.weixin\.qq\.com/i.test(finalUrl) && /环境异常|去验证|访问过于频繁|请输入验证码/.test(html) && !/id="js_content"/.test(html)) {
    throw new ImportError(
      '微信检测到自动访问，暂时没有返回文章。可以打开文章后全选复制，再用「粘贴正文」导入。',
      'WECHAT_BLOCKED',
      422,
    );
  }

  const $ = cheerio.load(html);
  const meta = extractMeta($, finalUrl);
  const root = pickArticleRoot($);
  const wrapper = $('<div></div>').append(root.clone());
  cleanArticleDom($, wrapper);
  wrapper.find('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('data-src') || $img.attr('data-original') || $img.attr('src');
    if (src) $img.attr('src', absolutize(src, finalUrl));
    $img.removeAttr('data-src').removeAttr('data-original').removeAttr('data-lazy-src');
  });
  wrapper.find('a[href]').each((_, el) => {
    const $a = $(el);
    $a.attr('href', absolutize($a.attr('href'), finalUrl));
  });

  let contentHtml = wrapper.html() || '';
  if (htmlToText(contentHtml).length < 60) {
    throw new ImportError(
      '没有识别到足够的正文内容，可以换一个链接，或用「粘贴正文」导入。',
      'EMPTY_ARTICLE',
      422,
    );
  }
  if (meta.description) {
    contentHtml = `<p class="article-lead">${escapeHtml(meta.description)}</p>${contentHtml}`;
  }
  if (bookId) {
    contentHtml = await cacheArticleImages(contentHtml, finalUrl, { bookId, referer: finalUrl });
  }
  const chapters = splitHtmlIntoChapters(contentHtml, meta.title);
  return finalizeContent({
    title: meta.title,
    author: meta.author || meta.site,
    format: 'web',
    chapters,
    sourceUrl: finalUrl,
    sourceType: /mp\.weixin\.qq\.com/i.test(finalUrl) ? 'wechat' : 'web',
    meta: {
      site: meta.site,
      published: meta.published,
      description: meta.description,
    },
  });
}

export function parsePastedContent({ content = '', title = '', sourceUrl = '', html = false }) {
  const lookingLikeHtml = html || /<\/?[a-z][\s\S]*>/i.test(content);
  if (!String(content).trim()) throw new ImportError('粘贴的内容为空', 'EMPTY_CONTENT');
  if (lookingLikeHtml) {
    const $ = cheerio.load(`<body>${content}</body>`);
    const root = pickArticleRoot($);
    const wrapper = $('<div></div>').append(root.clone());
    cleanArticleDom($, wrapper);
    wrapper.find('img').each((_, el) => {
      const $img = $(el);
      const src = $img.attr('data-src') || $img.attr('data-original') || $img.attr('src');
      if (src && sourceUrl) $img.attr('src', absolutize(src, sourceUrl));
      $img.removeAttr('data-src').removeAttr('data-original');
    });
    const contentHtml = wrapper.html() || content;
    const chapters = splitHtmlIntoChapters(contentHtml, cleanTitle(title, '粘贴的文章'));
    return finalizeContent({
      title: title || $('title').text() || '粘贴的文章',
      author: '',
      format: 'web',
      chapters,
      sourceUrl,
      sourceType: 'paste',
    });
  }
  const clean = normalizeText(content);
  const lines = clean.split('\n');
  const headings = detectHeadings(lines);
  let chapters;
  if (headings.length >= 2) {
    chapters = [];
    headings.forEach((heading, i) => {
      const end = i + 1 < headings.length ? headings[i + 1].index : lines.length;
      const body = lines.slice(heading.index + 1, end);
      chapters.push(makeChapter(heading.title, paragraphsToHtml(body), normalizeText(body.join('\n'))));
    });
  } else {
    chapters = splitLongText(clean, cleanTitle(title, '粘贴的文章'));
  }
  return finalizeContent({
    title: title || '粘贴的文章',
    format: 'web',
    chapters,
    sourceUrl,
    sourceType: 'paste',
  });
}

export function parseHtmlFile(buffer, filename = '网页存档') {
  const html = decodeText(buffer);
  const $ = cheerio.load(html);
  const meta = extractMeta($, 'https://local.invalid/');
  const root = pickArticleRoot($);
  const wrapper = $('<div></div>').append(root.clone());
  cleanArticleDom($, wrapper);
  const contentHtml = wrapper.html() || '';
  const chapters = splitHtmlIntoChapters(contentHtml || html, cleanTitle(meta.title || filename));
  return finalizeContent({
    title: meta.title || filename,
    author: meta.author,
    format: 'html',
    chapters,
    sourceType: 'upload',
  });
}

/* ------------------------------------------------------------------ */
/* EPUB                                                                 */
/* ------------------------------------------------------------------ */

function resolveZipPath(baseFile, relative) {
  const dir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1) : '';
  const combined = `${dir}${relative}`;
  const parts = [];
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export async function parseEpub(buffer, filename = '未命名') {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files || {});
  const totalUncompressed = entries.reduce(
    (sum, entry) => sum + (entry?._data?.uncompressedSize || 0),
    0,
  );
  if (totalUncompressed > 160 * 1024 * 1024) {
    throw new ImportError('EPUB 解压后体积过大，无法安全导入', 'EPUB_TOO_LARGE', 413);
  }
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new ImportError('EPUB 文件缺少 container.xml', 'INVALID_EPUB');
  const container = cheerio.load(await containerFile.async('string'), { xmlMode: true });
  const rootPath = container('rootfile').attr('full-path');
  if (!rootPath) throw new ImportError('EPUB 文件结构不完整', 'INVALID_EPUB');
  const opfFile = zip.file(rootPath);
  if (!opfFile) throw new ImportError('EPUB 找不到内容清单', 'INVALID_EPUB');
  const opf = cheerio.load(await opfFile.async('string'), { xmlMode: true });

  const title =
    opf('metadata title').first().text().trim() ||
    opf('dc\\:title').first().text().trim() ||
    cleanTitle(filename, '未命名');
  const author =
    opf('metadata creator').first().text().trim() ||
    opf('dc\\:creator').first().text().trim() ||
    '';

  const manifest = new Map();
  opf('manifest item').each((_, el) => {
    const id = opf(el).attr('id');
    const href = opf(el).attr('href');
    if (id && href) {
      manifest.set(id, {
        href: resolveZipPath(rootPath, decodeURIComponent(href)),
        mediaType: opf(el).attr('media-type') || '',
        properties: opf(el).attr('properties') || '',
      });
    }
  });

  const titleByFile = new Map();
  const navItem = [...manifest.values()].find((item) => /nav/.test(item.properties));
  if (navItem && zip.file(navItem.href)) {
    const nav = cheerio.load(await zip.file(navItem.href).async('string'), { xmlMode: false });
    nav('nav a, a').each((_, el) => {
      const href = nav(el).attr('href');
      const text = nav(el).text().trim();
      if (!href || !text) return;
      const target = resolveZipPath(navItem.href, href.split('#')[0]);
      if (!titleByFile.has(target)) titleByFile.set(target, text);
    });
  }

  const chapters = [];
  const spine = opf('spine itemref').toArray().slice(0, 500);
  for (let index = 0; index < spine.length; index += 1) {
    const idref = opf(spine[index]).attr('idref');
    const item = manifest.get(idref);
    if (!item) continue;
    const file = zip.file(item.href);
    if (!file) continue;
    const raw = await file.async('string');
    const $ = cheerio.load(raw);
    $('script,style,noscript,iframe,form,svg,canvas,video,audio').remove();
    $('body img').each((_, el) => {
      const $img = $(el);
      const src = $img.attr('src');
      if (!src || src.startsWith('data:')) return;
      const target = resolveZipPath(item.href, src.split('#')[0]);
      const image = zip.file(target);
      if (!image) return;
      const ext = path.extname(target).slice(1).toLowerCase();
      const mime =
        { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', svg: 'svg' }[ext] ||
        'jpeg';
      if (mime === 'svg') {
        $img.remove();
        return;
      }
      $img.attr('data-epub-src', target);
    });
    const images = $('img[data-epub-src]').toArray();
    for (const el of images) {
      const $img = $(el);
      const target = $img.attr('data-epub-src');
      const image = target ? zip.file(target) : null;
      if (!image) {
        $img.remove();
        continue;
      }
      const ext = path.extname(target).slice(1).toLowerCase();
      const mime =
        { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext];
      if (!mime) {
        $img.remove();
        continue;
      }
      const data = await image.async('base64');
      if (data.length > 3.5 * 1024 * 1024) {
        $img.remove();
        continue;
      }
      $img.attr('src', `data:${mime};base64,${data}`).removeAttr('data-epub-src');
    }

    const bodyHtml = $('body').html() || '';
    if (htmlToText(bodyHtml).length < 20) continue;
    const heading = $('h1,h2,h3').first().text().trim();
    const chapterTitle =
      titleByFile.get(item.href) || heading || `第 ${chapters.length + 1} 章`;
    chapters.push(makeChapter(chapterTitle, bodyHtml, htmlToText(bodyHtml)));
  }

  if (!chapters.length) throw new ImportError('EPUB 中没有找到可阅读的正文', 'EMPTY_EPUB');
  return finalizeContent({
    title,
    author,
    format: 'epub',
    chapters,
    meta: { chapters: chapters.length },
  });
}

/* ------------------------------------------------------------------ */
/* 导出                                                                 */
/* ------------------------------------------------------------------ */

export async function parseUpload({ buffer, filename, bookId }) {
  const ext = path.extname(filename).toLowerCase();
  try {
    switch (ext) {
      case '.txt':
        return parseText(buffer, filename);
      case '.md':
      case '.markdown':
        return parseMarkdown(buffer, filename);
      case '.pdf':
        return await parsePdf(buffer, filename);
      case '.docx':
        return await parseDocx(buffer, filename);
      case '.doc':
        return await parseDoc(buffer, filename);
      case '.html':
      case '.htm':
        return await parseHtmlFile(buffer, filename);
      case '.epub':
        return await parseEpub(buffer, filename);
      default:
        throw new ImportError(
          '暂不支持这个文件格式。支持 TXT、Markdown、PDF、Word（docx / doc）、HTML、EPUB。',
          'UNSUPPORTED_FORMAT',
        );
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    console.error('[parse]', filename, err);
    throw new ImportError(
      `无法解析这个文件（${ext || '未知格式'}）。文件可能已损坏、加密，或不是真正的 ${ext.replace('.', '').toUpperCase()} 文件。`,
      'PARSE_FAILED',
      400,
    );
  }
}
