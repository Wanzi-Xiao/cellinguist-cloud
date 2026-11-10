const SESSION_KEY = 'cellinguist.session.v1';
const LOGIN_KEY = 'cellinguist.login.v1';

export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function challengeFor(verifier, crypto = globalThis.crypto) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function validateConfig(raw, origin) {
  if (!raw || !raw.apiUrl || !raw.cognitoDomain || !raw.clientId || !raw.redirectUri) return null;
  const result = {};
  for (const key of ['apiUrl', 'cognitoDomain', 'redirectUri']) {
    const url = new URL(raw[key]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('The workspace connection configuration is invalid.');
    }
    if (key !== 'redirectUri' && url.pathname !== '/') throw new Error('Expected a service origin in workspace configuration.');
    result[key] = key === 'redirectUri' ? url.href : url.origin;
  }
  if (new URL(result.redirectUri).origin !== origin) throw new Error('Open the workspace at its configured CloudFront address to sign in.');
  if (!/^[a-z0-9]{1,128}$/i.test(raw.clientId)) throw new Error('The sign-in client configuration is invalid.');
  return { ...result, clientId: raw.clientId };
}

export class AuthSession {
  constructor(config, {storage = globalThis.sessionStorage, crypto = globalThis.crypto, fetch = (...args) => globalThis.fetch(...args), now = Date.now} = {}) {
    Object.assign(this, {config, storage, crypto, fetch, now});
  }
  get binding() { return `${this.config.cognitoDomain}|${this.config.clientId}|${this.config.redirectUri}`; }
  read(key) {
    try { return JSON.parse(this.storage.getItem(key)); } catch { this.storage.removeItem(key); return null; }
  }
  token() {
    const session = this.read(SESSION_KEY);
    if (!session || session.binding !== this.binding || !Number.isFinite(session.expiresAt) || session.expiresAt <= this.now() + 30000 || typeof session.accessToken !== 'string') {
      this.storage.removeItem(SESSION_KEY);
      return null;
    }
    return session.accessToken;
  }
  clear() { this.storage.removeItem(SESSION_KEY); this.storage.removeItem(LOGIN_KEY); }
  async loginUrl() {
    this.clear();
    const verifier = base64url(this.crypto.getRandomValues(new Uint8Array(48)));
    const state = base64url(this.crypto.getRandomValues(new Uint8Array(32)));
    this.storage.setItem(LOGIN_KEY, JSON.stringify({verifier, state, binding: this.binding, createdAt: this.now()}));
    const url = new URL('/oauth2/authorize', this.config.cognitoDomain);
    url.search = new URLSearchParams({response_type: 'code', client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri, scope: 'openid email profile', state,
      code_challenge_method: 'S256', code_challenge: await challengeFor(verifier, this.crypto)});
    return url.href;
  }
  async callback(params) {
    const transaction = this.read(LOGIN_KEY);
    this.storage.removeItem(LOGIN_KEY); // A transaction is single-use, including failures.
    this.storage.removeItem(SESSION_KEY);
    if (!transaction || transaction.binding !== this.binding || !transaction.state || params.get('state') !== transaction.state || !Number.isFinite(transaction.createdAt) || this.now() - transaction.createdAt > 600000 || this.now() < transaction.createdAt) {
      throw new Error('Your sign-in request expired or could not be verified. Please sign in again.');
    }
    if (params.has('error') || !params.get('code')) throw new Error('Sign-in was not completed. Please try again.');
    const result = await this.fetch(`${this.config.cognitoDomain}/oauth2/token`, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type: 'authorization_code', client_id: this.config.clientId,
        code: params.get('code'), code_verifier: transaction.verifier, redirect_uri: this.config.redirectUri}),
      signal: AbortSignal.timeout(15000)
    });
    if (!result.ok) throw new Error('Sign-in could not be completed. Please start again.');
    const tokens = await result.json();
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || !/^bearer$/i.test(tokens.token_type) || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 30) {
      throw new Error('The sign-in service returned an invalid session.');
    }
    // Keep only the access token in this tab; discard ID and refresh tokens.
    // API Gateway verifies the signature/issuer/audience; browser parsing never authorizes a request.
    this.storage.setItem(SESSION_KEY, JSON.stringify({binding: this.binding, accessToken: tokens.access_token,
      expiresAt: this.now() + Math.min(tokens.expires_in, 3600) * 1000}));
  }
  logoutUrl() {
    this.clear();
    const url = new URL('/logout', this.config.cognitoDomain);
    url.search = new URLSearchParams({client_id: this.config.clientId, logout_uri: this.config.redirectUri});
    return url.href;
  }
}
