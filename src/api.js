async function request(path, options = {}) {
  const { body, headers, ...rest } = options;
  const isForm = body instanceof FormData;
  const response = await fetch(path, {
    ...rest,
    headers: {
      ...(isForm ? {} : body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    data = text ? { message: text } : null;
  }
  if (!response.ok) {
    const message =
      data?.error?.message || data?.message || `请求失败（HTTP ${response.status}）`;
    const error = new Error(message);
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  uploadBook: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/api/books/upload', { method: 'POST', body: form });
  },
  importUrl: (url) =>
    request('/api/books/import-url', { method: 'POST', body: { url } }),
  importPaste: ({ content, title, sourceUrl, html }) =>
    request('/api/books/import-paste', {
      method: 'POST',
      body: { content, title, sourceUrl, html },
    }),
  getContent: (id) => request(`/api/books/${id}/content`),
  updateBook: (id, patch) =>
    request(`/api/books/${id}`, { method: 'PATCH', body: patch }),
  saveProgress: (id, progress) =>
    request(`/api/books/${id}/progress`, { method: 'PATCH', body: progress }),
  deleteBook: (id) => request(`/api/books/${id}`, { method: 'DELETE' }),
  searchBook: (id, q) =>
    request(`/api/books/${id}/search?q=${encodeURIComponent(q)}`),
  searchAll: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
  getSettings: () => request('/api/settings'),
  saveSettings: (payload) =>
    request('/api/settings', { method: 'PUT', body: payload }),
  testAi: () => request('/api/ai/test', { method: 'POST' }),
  getThreads: () => request('/api/threads'),
  getThread: (id) => request(`/api/threads/${id}`),
  createThread: (payload = {}) =>
    request('/api/threads', { method: 'POST', body: payload }),
  updateThread: (id, payload) =>
    request(`/api/threads/${id}`, { method: 'PATCH', body: payload }),
  deleteThread: (id) => request(`/api/threads/${id}`, { method: 'DELETE' }),
  ask: (payload) => request('/api/ask', { method: 'POST', body: payload }),
  getMaps: (bookId = '') =>
    request(`/api/maps${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ''}`),
  getMap: (id) => request(`/api/maps/${id}`),
  createMap: (payload) => request('/api/maps', { method: 'POST', body: payload }),
  updateMap: (id, payload) =>
    request(`/api/maps/${id}`, { method: 'PATCH', body: payload }),
  reviseMap: (id, instruction) =>
    request(`/api/maps/${id}/revise`, { method: 'POST', body: { instruction } }),
  deleteMap: (id) => request(`/api/maps/${id}`, { method: 'DELETE' }),
  generateMap: (payload) =>
    request('/api/maps/generate', { method: 'POST', body: payload }),
};

export function fileUrl(id) {
  return `/api/books/${id}/file`;
}
