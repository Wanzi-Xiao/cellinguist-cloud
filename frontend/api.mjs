export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class ApiClient {
  constructor(baseUrl, auth, fetch = (...args) => globalThis.fetch(...args)) { Object.assign(this, {baseUrl, auth, fetch}); }
  async request(path, {method = 'GET', body, publicRoute = false} = {}) {
    const headers = {accept: 'application/json'};
    if (!publicRoute) {
      const token = this.auth.token();
      if (!token) throw new ApiError(401, 'Your session has ended. Sign in to continue.');
      headers.authorization = `Bearer ${token}`;
    }
    if (body) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {method, headers,
        body: body ? JSON.stringify(body) : undefined, credentials: 'omit', redirect: 'error',
        cache: 'no-store', signal: AbortSignal.timeout(20000)});
    } catch {
      throw new ApiError(0, 'Could not reach the workspace. Check your connection and try again.');
    }
    if (!response.ok) {
      const messages = {400: 'That selection is not available in the approved catalog.',
        401: 'Your session has ended. Sign in to continue.', 403: 'Your account cannot access this workspace.',
        404: 'This result is not available yet.', 429: 'Too many requests. Wait a moment and try again.'};
      throw new ApiError(response.status, messages[response.status] || 'The workspace could not complete this request. Please try again.');
    }
    try { return await response.json(); } catch { throw new ApiError(502, 'The workspace returned an unreadable response.'); }
  }
  catalog() { return this.request('/catalog'); }
  result(cellType, conditionId) { return this.request(`/results?${new URLSearchParams({cell_type: cellType, condition: conditionId})}`); }
  history() { return this.request('/history'); }
  save(cellType, conditionId) { return this.request('/history', {method: 'POST', body: {cellType, conditionId}}); }
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function catalogEntries(payload) {
  if (!payload || !Array.isArray(payload.entries)) throw new Error('The result catalog is unavailable. Please try again later.');
  const seen = new Set();
  return payload.entries.filter(entry => {
    if (!entry || typeof entry.cellType !== 'string' || typeof entry.conditionId !== 'string' || !SLUG.test(entry.cellType) || !SLUG.test(entry.conditionId)) return false;
    const key = `${entry.cellType}/${entry.conditionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readable(value) { return String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
