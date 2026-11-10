import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthSession, challengeFor, validateConfig} from '../auth.mjs';

const config = {apiUrl: 'https://api.example.test', cognitoDomain: 'https://login.example.test', clientId: 'testclient123', redirectUri: 'https://workspace.example.test/'};
function fixture({now = () => 1000000, fetch} = {}) {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  return {auth: new AuthSession(config, {storage, now, fetch}), values};
}
const tokens = {access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600};
async function pending(auth) {
  const url = new URL(await auth.loginUrl());
  return new URLSearchParams({code: 'test-code', state: url.searchParams.get('state')});
}

test('PKCE matches the RFC 7636 SHA-256 example', async () => {
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('unconfigured preview stays disconnected and configuration requires same-origin HTTPS callback', () => {
  assert.equal(validateConfig({}, 'https://workspace.example.test'), null);
  assert.deepEqual(validateConfig(config, 'https://workspace.example.test'), config);
  for (const change of [{redirectUri: 'https://wrong.example.test/'}, {apiUrl: 'http://api.example.test'}, {cognitoDomain: 'https://login.example.test/?unexpected=yes'}, {clientId: 'bad value'}]) {
    assert.throws(() => validateConfig({...config, ...change}, 'https://workspace.example.test'));
  }
});
test('login uses code flow, random state and S256, never implicit flow', async () => {
  const {auth} = fixture();
  const a = new URL(await auth.loginUrl()), b = new URL(await auth.loginUrl());
  assert.equal(a.pathname, '/oauth2/authorize');
  assert.equal(a.searchParams.get('response_type'), 'code');
  assert.equal(a.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(a.searchParams.get('state'), b.searchParams.get('state'));
  assert.equal(a.searchParams.get('redirect_uri'), config.redirectUri);
});
test('state mismatch rejects callback without exchanging the code', async () => {
  let calls = 0;
  const {auth} = fixture({fetch: () => { calls++; }});
  const params = await pending(auth);
  params.set('state', 'attacker-state');
  await assert.rejects(auth.callback(params), /could not be verified/);
  assert.equal(calls, 0);
  assert.equal(auth.token(), null);
});
test('successful exchange sends verifier and stores only tab access token; callback is single-use', async () => {
  let sent;
  const {auth, values} = fixture({fetch: async (url, options) => {
    sent = {url, options}; return {ok: true, json: async () => ({...tokens, id_token: 'discard-id', refresh_token: 'discard-refresh'})};
  }});
  const params = await pending(auth);
  await auth.callback(params);
  assert.equal(auth.token(), tokens.access_token);
  assert.equal(sent.url, 'https://login.example.test/oauth2/token');
  assert.equal(sent.options.body.get('grant_type'), 'authorization_code');
  assert.ok(sent.options.body.get('code_verifier').length >= 43);
  assert.equal(sent.options.credentials, 'omit');
  assert.ok(!JSON.stringify([...values]).includes('discard-'));
  await assert.rejects(auth.callback(params), /could not be verified/);
});
test('expired transaction is rejected, logout clears tab session, expired access token is discarded', async () => {
  let clock = 1000000;
  const {auth} = fixture({now: () => clock, fetch: async () => ({ok: true, json: async () => tokens})});
  const stale = await pending(auth);
  clock += 600001;
  await assert.rejects(auth.callback(stale), /expired/);
  await auth.callback(await pending(auth));
  const logout = new URL(auth.logoutUrl());
  assert.equal(logout.pathname, '/logout');
  assert.equal(logout.searchParams.get('logout_uri'), config.redirectUri);
  assert.equal(auth.token(), null);
  await auth.callback(await pending(auth));
  clock += 3600000;
  assert.equal(auth.token(), null);
});
test('session is bound to its configured client and callback', async () => {
  const {auth} = fixture({fetch: async () => ({ok: true, json: async () => tokens})});
  await auth.callback(await pending(auth));
  auth.config = {...config, clientId: 'differentclient'};
  assert.equal(auth.token(), null);
});
test('provider rejection or malformed token response does not create a session', async () => {
  for (const response of [{ok: false}, {ok: true, json: async () => ({...tokens, expires_in: -1})}]) {
    const {auth} = fixture({fetch: async () => response});
    await assert.rejects(auth.callback(await pending(auth)));
    assert.equal(auth.token(), null);
  }
});
