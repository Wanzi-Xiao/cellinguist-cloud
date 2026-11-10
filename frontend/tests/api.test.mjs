import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient, catalogEntries} from '../api.mjs';

test('API uses access token and never accepts a client-supplied user identity', async () => {
  let sent;
  const api = new ApiClient('https://api.example.test', {token: () => 'access'}, async (url, options) => {
    sent = {url, ...options}; return {ok: true, json: async () => ({})};
  });
  await api.save('t-cell', 'ifn-gamma');
  assert.equal(sent.headers.authorization, 'Bearer access');
  assert.deepEqual(JSON.parse(sent.body), {cellType: 't-cell', conditionId: 'ifn-gamma'});
  assert.equal(sent.credentials, 'omit');
  assert.equal(sent.redirect, 'error');
  await api.request('/health', {publicRoute: true});
  assert.equal(sent.headers.authorization, undefined);
});
test('expired session makes no authenticated network request', async () => {
  let calls = 0;
  const api = new ApiClient('', {token: () => null}, () => { calls++; });
  await assert.rejects(api.history(), err => err.status === 401);
  assert.equal(calls, 0);
});
test('backend failures and throttling show safe actionable messages', async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const api = new ApiClient('', {token: () => 'access'}, async () => ({ok: false, status}));
    await assert.rejects(api.catalog(), err => err.status === status && !err.message.includes('undefined'));
  }
});
test('catalog filters traversal, malformed entries and duplicate pairs', () => {
  const good = {cellType: 't-cell', conditionId: 'ifn-gamma'};
  assert.deepEqual(catalogEntries({entries: [good, good, null, {cellType: '../private', conditionId: 'bad'}, {cellType: 2, conditionId: 'x'}]}), [good]);
  assert.throws(() => catalogEntries({}));
});
