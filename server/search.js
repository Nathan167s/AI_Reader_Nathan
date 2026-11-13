import * as cheerio from 'cheerio';
import { callAI, resolveAi } from './ai.js';
import { getSettings } from './store.js';

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();

function cleanText(value = '') {
  return String(value)
    .replace(/[\uE000-\uF8FF]/g, ' ')
    .replace(/\s*(播报|暂停)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function decodeBingUrl(href = '') {
  try {
    const url = new URL(href, 'https://www.bing.com');
    if (!/bing\.com$/i.test(url.hostname)) return url.toString();
    const encoded = url.searchParams.get('u');
    if (!encoded) return url.toString();
    let value = encoded;
    if (value.startsWith('a1')) value = value.slice(2);
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return url.toString();
  } catch {
    return href;
  }
}

const META_INSTRUCTION_WORDS =
  /请问|请帮我|帮我|我想知道|能不能|可以|这本书|本文|文中|搜索相关资料|搜索一下|搜索|检索|查找|查一下|相关资料|资料|总结|梳理|概括|归纳|详细一点|详细|具体一点|具体|展开|继续|多说|再讲|一点|一下|一些|相关/gi;

const META_QUERY_PATTERN =
  /搜索相关资料|检索相关|详细一点|再详细|继续展开|总结当今|相关资料|该概念|这个概念|详细说明|说说看|讲讲看/;

function isFollowUp(question = '') {
  return /详细|继续|展开|具体|多说|再讲|补充|补一下|然后|这个|该|它|其|上述|前面|此/.test(
    question,
  );
}

function isMetaQuery(query = '') {
  const text = String(query || '').trim();
  return text.length < 3 || META_QUERY_PATTERN.test(text);
}

function heuristicQuery(question = '', options = {}) {
  const previous = cleanText(options.previousQuery || '').slice(0, 80);
  const stripped = String(question)
    .replace(
      /请问|请帮我|帮我|我想知道|能不能|可以|这本书|本文|文中|作者|一下|说一说|讲讲|解释|分析|什么是|是什么|为什么|怎么样|如何|怎么|有什么关系|什么关系|有哪些|吗|呢/gi,
      ' ',
    )
    .replace(META_INSTRUCTION_WORDS, ' ')
    .replace(/该概念|这个概念|上述概念|其观点|这种说法/g, ' ')
    .replace(/[和与跟]/g, ' ')
    .replace(/[？?！!。，,、；;：:（）()“”"'《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // “详细一点”“该概念”等追问本身没有主题，优先沿用上一轮实际搜索词。
  if (previous && !isMetaQuery(previous) && (isFollowUp(question) || stripped.length < 4)) {
    return previous;
  }
  return stripped.slice(0, 60);
}

function polishQuery(value, fallback) {
  const polished = cleanText(
    String(value || '')
      .replace(/^["“]|["”]$/g, '')
      .replace(/[？?！!。，,、；;：:（）()“”"'《》]/g, ' ')
      .replace(META_INSTRUCTION_WORDS, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, 80);
  if (!polished || isMetaQuery(polished)) return fallback;
  return polished;
}

export async function optimizeSearchQuery(question, context = '', options = {}) {
  const fallback = heuristicQuery(question, options);
  const settings = await getSettings();
  if (!resolveAi(settings).configured) return fallback;
  try {
    const result = await callAI(
      [
        {
          role: 'system',
          content:
            '你是搜索查询优化器。只输出一条适合搜索引擎的中文查询词，不要解释，不要引号，不要换行。只保留核心实体关键词，不要保留“和、与、关系、问题、如何、为什么”等连接词或疑问词。遇到“详细一点”“该概念”等追问，要结合最近对话补全主题。',
        },
        {
          role: 'user',
          content: `用户问题：${question}\n最近对话：${String(options.history || '（无）').slice(0, 1200)}\n书本素材摘要：${String(context).slice(0, 800)}\n请生成一条简洁查询，例如“慢读 注意力经济”“海德格尔 在世存在”，不超过 24 字。`,
        },
      ],
      // deepseek-v4-flash 会先消耗 reasoning tokens；60/200 会在正式输出前被截断。
      { maxTokens: 800, temperature: 0.1, timeout: 45000 },
    );
    return polishQuery(result.content, fallback) || fallback;
  } catch (err) {
    console.warn(
      '[search] query optimize failed:',
      err.code || '',
      err.message,
      'fallback=',
      JSON.stringify(fallback),
    );
    return fallback;
  }
}

function relevanceScore(result, query) {
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  const terms = String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length >= 2);
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 3;
  }
  const cjk = String(query).match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i += 1) {
      if (haystack.includes(run.slice(i, i + 2))) score += 1;
    }
  }
  return score;
}

const AD_WORDS = /广告|商城|推广|招聘|优惠|折扣|下载|代理|加盟|营销|淘宝|京东|拼多多/i;
const LOW_QUALITY_HOST = /(^|\.)(douyin\.com|kuaishou\.com|xiaohongshu\.com)$/i;

async function bingSearch(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=4`;
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  $('.b_ad, li.b_ad, .b_adLastChild, #b_results > .b_pag').remove();
  const raw = [];
  $('li.b_algo').each((_, element) => {
    if (raw.length >= 12) return;
    const $item = $(element);
    const link = $item.find('h2 a').first();
    const title = cleanText(link.text());
    const href = decodeBingUrl(link.attr('href') || '');
    const snippet = cleanText(
      $item.find('.b_caption p, .b_snippet, .b_algoSlug').first().text(),
    );
    if (!title || !href || !/^https?:/i.test(href)) return;
    raw.push({ title, url: href, snippet });
  });
  return raw;
}

function stripHtml(value = '') {
  return cleanText(String(value).replace(/<[^>]*>/g, ' '));
}

function extractBaiduSnippet($item, title) {
  const explicit = $item
    .find(
      '.c-abstract, .content-right_8Zs40, .c-span-last, [class*="content-right"], .op-xueshu-links-d20-subtitle, .op-xueshu-links-d20-subinfo',
    )
    .text();
  if (cleanText(explicit)) return cleanText(explicit);

  // 百度百科 / 视频卡把摘要放在 s-data 的内嵌 JSON 里。
  const html = $item.html() || '';
  const briefMatch = html.match(/"brief"\s*:\s*"((?:\\.|[^"\\])*)"/s);
  if (briefMatch) {
    let brief = briefMatch[1];
    try {
      brief = JSON.parse(`"${brief}"`);
    } catch {
      brief = brief.replace(/\\"/g, '"');
    }
    const cleaned = stripHtml(brief);
    if (cleaned) return cleaned;
  }

  return cleanText($item.text().replace(title, ''));
}

async function baiduSearch(query) {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=4&ie=utf-8`;
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  $('#content_left .ec_result, #content_left .result-op').remove();
  const raw = [];
  $('#content_left .result, #content_left .c-container').each((_, element) => {
    if (raw.length >= 14) return;
    const $item = $(element);
    const link = $item.find('h3 a').first();
    const title = cleanText(link.text());
    const href = link.attr('href') || '';
    if (!title || !/^https?:/i.test(href)) return;
    if (/^https?:\/\/www\.baidu\.com\/s\?/i.test(href)) return;
    const snippet = extractBaiduSnippet($item, title);
    if (!snippet) return;
    raw.push({ title, url: href, snippet });
  });
  return raw;
}

async function resolveResultUrl(item) {
  if (!/baidu\.com\/link\?/i.test(item.url)) return item;
  try {
    const response = await fetch(item.url, {
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get('location');
    if (location && /^https?:/i.test(location)) {
      return { ...item, url: location };
    }
  } catch {
    // 保留百度跳转链接
  }
  return item;
}

export function cleanSearchResults(raw = [], query = '') {
  const seen = new Set();
  const cleaned = [];
  raw.forEach((item, index) => {
    let url;
    try {
      url = new URL(item.url);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return;
    if (LOW_QUALITY_HOST.test(url.hostname)) return;
    const normalizedUrl = `${url.origin}${url.pathname}${url.search}`;
    if (seen.has(normalizedUrl)) return;
    if (/bing\.com|go\.microsoft\.com/i.test(url.hostname)) return;
    if (AD_WORDS.test(`${item.title} ${item.snippet}`)) return;
    if (!item.title || !item.snippet) return;
    const score = relevanceScore(item, query);
    if (score <= 0) return;
    seen.add(normalizedUrl);
    cleaned.push({
      title: item.title.slice(0, 120),
      url: normalizedUrl,
      snippet: cleanText(item.snippet).slice(0, 250),
      score: score + Math.max(0, 10 - index),
      position: index,
    });
  });
  cleaned.sort((a, b) => b.score - a.score || a.position - b.position);
  return cleaned.slice(0, 4);
}

export function buildWebContext(results = []) {
  if (!results.length) return '';
  const lines = ['【联网搜索补充资料】'];
  let total = lines[0].length;
  results.forEach((item, index) => {
    const block = `\n[网络来源 ${index + 1}] ${item.title}\n${item.url}\n${item.snippet}`;
    if (total + block.length > 1000) return;
    lines.push(block);
    total += block.length;
  });
  return lines.length > 1 ? lines.join('\n') : '';
}

export async function searchForQuestion(question, context = '', options = {}) {
  const query = await optimizeSearchQuery(question, context, options);
  if (!query || isMetaQuery(query)) {
    return {
      query,
      results: [],
      context: '',
      cached: false,
      error: '查询词过于泛化，已跳过联网搜索',
    };
  }
  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { query, results: cached.results, context: buildWebContext(cached.results), cached: true };
  }
  try {
    let raw;
    try {
      raw = await baiduSearch(query);
    } catch (baiduError) {
      console.warn('[search] baidu failed, trying bing', baiduError.message);
      raw = await bingSearch(query);
    }
    if (!raw.length) {
      console.warn('[search] baidu returned no parsable results, trying bing');
      raw = await bingSearch(query);
    }
    let results = cleanSearchResults(raw, query);
    results = await Promise.all(results.map(resolveResultUrl));
    results = results.filter((item) => {
      try {
        return !LOW_QUALITY_HOST.test(new URL(item.url).hostname);
      } catch {
        return false;
      }
    });
    const seenResolved = new Set();
    results = results.filter((item) => {
      if (seenResolved.has(item.url)) return false;
      seenResolved.add(item.url);
      return true;
    });
    cache.set(query, { at: Date.now(), results });
    for (const [key, value] of cache) {
      if (Date.now() - value.at > CACHE_TTL) cache.delete(key);
    }
    return { query, results, context: buildWebContext(results), cached: false };
  } catch (err) {
    console.warn('[search]', err.message);
    return { query, results: [], context: '', cached: false, error: err.message };
  }
}
