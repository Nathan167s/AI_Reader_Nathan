import { getSettings } from './store.js';

export class AIError extends Error {
  constructor(message, code = 'AI_ERROR', status = 502) {
    super(message);
    this.code = code;
    this.status = status;
    this.expose = true;
  }
}

export function resolveAi(settings) {
  const envKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
  const apiKey = settings.ai.apiKey || envKey;
  let baseUrl = settings.ai.baseUrl || 'https://api.deepseek.com';
  if (!settings.ai.apiKey && process.env.OPENAI_API_KEY) {
    baseUrl = baseUrl || 'https://api.openai.com/v1';
  }
  baseUrl = String(baseUrl).trim().replace(/\/+$/, '');
  const endpoint = /\/chat\/completions$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/chat/completions`;
  return {
    apiKey,
    baseUrl,
    endpoint,
    model: settings.ai.model || 'deepseek-chat',
    provider: settings.ai.provider || 'deepseek',
    configured: Boolean(apiKey),
  };
}

export async function callAI(messages, options = {}) {
  const settings = await getSettings();
  const ai = resolveAi(settings);
  if (!ai.configured) {
    throw new AIError(
      '还没有配置 AI 服务。到「设置 → AI 服务」填入 API Key，或继续使用本地检索模式。',
      'AI_NOT_CONFIGURED',
      400,
    );
  }
  let response;
  try {
    response = await fetch(ai.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        messages,
        temperature: options.temperature ?? 0.35,
        max_tokens: options.maxTokens ?? 1400,
        stream: false,
      }),
      signal: AbortSignal.timeout(options.timeout ?? 90000),
    });
  } catch (err) {
    throw new AIError(
      err.name === 'TimeoutError'
        ? 'AI 服务响应超时，请稍后重试。'
        : `无法连接 AI 服务：${err.message}`,
      'AI_NETWORK_ERROR',
      502,
    );
  }

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail =
      data?.error?.message || raw.replace(/\s+/g, ' ').slice(0, 220) || '未知错误';
    if (response.status === 401) {
      throw new AIError('API Key 无效或已过期，请在设置中检查。', 'AI_UNAUTHORIZED', 401);
    }
    if (response.status === 429) {
      throw new AIError('AI 服务请求过于频繁或额度不足，请稍后再试。', 'AI_RATE_LIMITED', 429);
    }
    throw new AIError(`AI 服务返回错误：${detail}`, 'AI_UPSTREAM_ERROR', 502);
  }
  const message = data?.choices?.[0]?.message;
  let content = message?.content;
  if ((!content || typeof content !== 'string') && message?.reasoning_content) {
    const reasoning = String(message.reasoning_content);
    const start = reasoning.indexOf('{');
    const end = reasoning.lastIndexOf('}');
    if (start >= 0 && end > start) content = reasoning.slice(start, end + 1);
  }
  if (!content || typeof content !== 'string') {
    throw new AIError('AI 返回了空内容，请重试。', 'AI_EMPTY_RESPONSE', 502);
  }
  return {
    content: content.trim(),
    usage: data.usage || null,
    model: data.model || ai.model,
  };
}

export async function testAIConnection() {
  const started = Date.now();
  const result = await callAI(
    [
      { role: 'system', content: '你是连接测试助手，只回复“连接成功”。' },
      { role: 'user', content: '请回复：连接成功' },
    ],
    { maxTokens: 20, temperature: 0, timeout: 30000 },
  );
  return {
    ok: true,
    latency: Date.now() - started,
    model: result.model,
    reply: result.content.slice(0, 50),
  };
}
