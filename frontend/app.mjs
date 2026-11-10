import {AuthSession, validateConfig} from './auth.mjs';
import {ApiClient, catalogEntries, readable} from './api.mjs';

const $ = id => document.getElementById(id);
const state = {entries: [], result: null, busy: false, authenticated: false};
let auth, api;
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function empty(title, description) { $('empty-title').textContent = title; $('empty-description').textContent = description; }
function resetResult() {
  state.result = null;
  $('result-content').hidden = true;
  $('result-empty').hidden = false;
  $('result-plot').removeAttribute('src');
  $('result-summary').textContent = '';
  controls();
}
function controls() {
  const ready = state.authenticated && !state.busy;
  $('cell-type').disabled = !ready || !state.entries.length;
  $('condition').disabled = !ready || !$('cell-type').value;
  $('view-button').disabled = !ready || !$('condition').value;
  $('save-button').disabled = !ready || !state.result;
  $('refresh-history').disabled = !ready;
  $('auth-button').disabled = !auth || state.busy;
  $('view-button').textContent = state.busy ? 'Working…' : 'Explore response ↗';
  for (const button of $('history-list').querySelectorAll('button')) button.disabled = !ready;
}
function option(value, label) { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; }
function conditions() {
  const entries = state.entries.filter(entry => entry.cellType === $('cell-type').value);
  $('condition').replaceChildren(option('', 'Choose a treatment'), ...entries.map(entry => option(entry.conditionId, readable(entry.conditionId))));
  controls();
}
function resetAccount() {
  state.authenticated = false;
  state.entries = [];
  $('session-label').textContent = 'Signed out';
  $('workspace-state').textContent = 'Signed out';
  $('workspace-caption').textContent = 'Sign in to explore and save';
  $('auth-button').textContent = 'Sign in / Sign up';
  $('history-count').textContent = '—';
  $('catalog-count').textContent = '—';
  $('cell-type').replaceChildren(option('', 'Sign in to load catalog'));
  $('condition').replaceChildren(option('', 'Choose a cell type first'));
  $('history-list').replaceChildren();
  $('history-empty').hidden = false;
  $('history-empty').textContent = 'Sign in to see your saved queries.';
  resetResult();
  empty('Your next insight starts here', 'Sign in, then choose a cell type and treatment to view an existing response.');
}
async function work(action) {
  if (state.busy) return;
  state.busy = true;
  error();
  notice();
  controls();
  $('workspace').setAttribute('aria-busy', 'true');
  try { await action(); }
  catch (err) {
    if (err.status === 401) { auth.clear(); resetAccount(); }
    error(err.message || 'Something went wrong. Please try again.');
  } finally { state.busy = false; $('workspace').removeAttribute('aria-busy'); controls(); }
}
function showPanel(history) {
  $('history-panel').hidden = !history;
  $('explorer-panel').hidden = history;
  for (const [id, active] of [['history-tab', history], ['explorer-tab', !history]]) {
    $(id).classList.toggle('active', active);
    if (active) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  $('breadcrumb').textContent = history ? 'Saved queries' : 'Response explorer';
  $('page-title').textContent = history ? 'Saved queries.' : 'Response explorer.';
  $('page-description').textContent = history ? 'Your exploration history, ready to pick up where you left off.' : 'Find a cell type. Choose a treatment. Explore its curated response.';
}
async function loadResult(cell, condition) {
  resetResult();
  const result = await api.result(cell, condition);
  if (result.precomputed !== true || !result.summary || typeof result.summary !== 'object') throw new Error('This response is not a supported precomputed result.');
  let plot;
  try { plot = new URL(result.plotUrl); } catch { throw new Error('This result has no valid plot link.'); }
  if (plot.protocol !== 'https:' || plot.username || plot.password) throw new Error('This result has no valid plot link.');
  state.result = {cell, condition};
  $('result-cell').textContent = readable(cell);
  $('result-condition').textContent = readable(condition);
  $('result-version').textContent = `Precomputed result · ${result.resultVersion || 'version unavailable'} · Plot link expires in 5 minutes`;
  $('result-summary').textContent = JSON.stringify(result.summary, null, 2);
  $('result-plot').hidden = false;
  $('plot-error').hidden = true;
  $('result-plot').alt = `Precomputed ${readable(condition)} response for ${readable(cell)}`;
  $('result-plot').src = plot.href;
  $('result-empty').hidden = true;
  $('result-content').hidden = false;
}
async function loadHistory() {
  const payload = await api.history();
  if (!Array.isArray(payload.items)) throw new Error('Your saved queries could not be loaded.');
  $('history-list').replaceChildren();
  const items = payload.items.slice(0, 50);
  $('history-count').textContent = String(items.length);
  $('history-empty').hidden = items.length > 0;
  $('history-empty').textContent = 'No saved queries yet. Explore a response and select Save query to start your research trail.';
  for (const item of items) {
    if (!item || typeof item.cellType !== 'string' || typeof item.conditionId !== 'string') continue;
    const row = document.createElement('li'), detail = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small'), button = document.createElement('button');
    title.textContent = `${readable(item.cellType)} · ${readable(item.conditionId)}`;
    const date = new Date(item.createdAt);
    meta.textContent = `${Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString()} · ${item.resultVersion || 'Version unavailable'}`;
    detail.append(title, meta);
    button.type = 'button'; button.className = 'button secondary'; button.textContent = 'Open query ↗';
    button.addEventListener('click', () => work(async () => {
      if (!state.entries.some(e => e.cellType === item.cellType && e.conditionId === item.conditionId)) throw new Error('This saved selection is no longer in the approved catalog.');
      showPanel(false);
      $('cell-type').value = item.cellType; conditions(); $('condition').value = item.conditionId;
      await loadResult(item.cellType, item.conditionId);
    }));
    row.append(detail, button); $('history-list').append(row);
  }
}
async function loadWorkspace() {
  state.authenticated = true;
  $('session-label').textContent = 'Researcher session';
  $('workspace-state').textContent = 'Personal';
  $('workspace-caption').textContent = 'Queries saved to your account';
  $('auth-button').textContent = 'Sign out';
  state.entries = catalogEntries(await api.catalog());
  $('catalog-count').textContent = String(state.entries.length);
  const cells = [...new Set(state.entries.map(entry => entry.cellType))];
  $('cell-type').replaceChildren(option('', cells.length ? 'Choose a cell type' : 'No approved results yet'), ...cells.map(cell => option(cell, readable(cell))));
  conditions();
  if (!cells.length) {
    empty('The catalog is ready for its first result', 'No approved results have been added yet. Your workspace is connected; check back when the curated catalog is available.');
    notice('You are signed in. The approved result catalog is currently empty.');
  } else empty('Choose a response to explore', 'Select a cell type and cytokine treatment to retrieve its precomputed summary and plot.');
  await loadHistory();
}

$('explorer-tab').addEventListener('click', () => showPanel(false));
$('history-tab').addEventListener('click', () => showPanel(true));
$('cell-type').addEventListener('change', () => { resetResult(); conditions(); });
$('condition').addEventListener('change', resetResult);
$('query-form').addEventListener('submit', e => { e.preventDefault(); if ($('view-button').disabled) return; work(() => loadResult($('cell-type').value, $('condition').value)); });
$('refresh-history').addEventListener('click', () => work(loadHistory));
$('save-button').addEventListener('click', () => work(async () => {
  if (!state.result) return;
  await api.save(state.result.cell, state.result.condition);
  notice('Query saved to your account.');
  try { await loadHistory(); } catch (err) { if (err.status === 401) throw err; error('The query was saved, but history could not be refreshed. Use Refresh to try again.'); }
}));
$('result-plot').addEventListener('error', () => { $('result-plot').hidden = true; $('plot-error').hidden = false; });
$('auth-button').addEventListener('click', () => work(async () => {
  if (state.authenticated) { const url = auth.logoutUrl(); resetAccount(); location.assign(url); }
  else location.assign(await auth.loginUrl());
}));

async function start() {
  try {
    const params = new URLSearchParams(location.search);
    const hasCallback = params.has('code') || params.has('error');
    // Remove codes and provider errors from the address bar before rendering or requesting assets.
    if (hasCallback) history.replaceState(null, '', location.pathname);
    const config = validateConfig(window.CELLINGUIST_CONFIG, location.origin);
    if (!config) { notice('This workspace has not been connected yet. Sign-in and results will be available after deployment.'); return; }
    auth = new AuthSession(config);
    api = new ApiClient(config.apiUrl, auth);
    if (hasCallback) await work(async () => { await auth.callback(params); await loadWorkspace(); });
    else if (auth.token()) await work(loadWorkspace);
    api.request('/health', {publicRoute: true}).then(() => {
      $('connection-status').textContent = 'Workspace connected'; $('connection-status').classList.add('connected');
    }).catch(() => { $('connection-status').textContent = 'Connection unavailable'; });
  } catch (err) { error(err.message || 'The workspace could not be initialized.'); }
  finally { controls(); }
}
// Clear personal content when a stored token expires, including on a restored background tab.
setInterval(() => { if (state.authenticated && !state.busy && !auth.token()) { auth.clear(); resetAccount(); notice('Your session has ended. Sign in again to continue.'); } }, 30000);
start();
