(() => {
  'use strict';
  const DEFAULTS = { model: 'chatgpt', pauseBeforeSubmit: true, autoAdvance: false, repo: '' };
  const models = { chatgpt: 'https://chatgpt.com/*', gemini: 'https://gemini.google.com/*', deepseek: 'https://chat.deepseek.com/*' };
  const byId = id => document.getElementById(id);
  let saveTimeout;
  async function refresh() {
    const state = await chrome.storage.sync.get(DEFAULTS);
    const selected = document.querySelector(`input[name="model"][value="${state.model}"]`);
    if (selected) selected.checked = true;
    for (const key of ['pauseBeforeSubmit', 'autoAdvance']) byId(key).checked = Boolean(state[key]);
    byId('repo').value = state.repo || '';
    await Promise.all(Object.entries(models).map(async ([model, pattern]) => {
      const tabs = await chrome.tabs.query({ url: pattern });
      byId(`status-${model}`).textContent = tabs.length ? 'Tab open' : 'Not open';
    }));
  }
  const save = async changes => {
    await chrome.storage.sync.set(changes);
    byId('saveStatus').textContent = 'Settings saved.';
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => byId('saveStatus').textContent = 'Settings are stored via Chrome sync.', 2500);
  };
  document.querySelectorAll('input[name="model"]').forEach(el => el.addEventListener('change', () => save({ model: el.value })));
  for (const key of ['pauseBeforeSubmit', 'autoAdvance']) byId(key).addEventListener('change', e => save({ [key]: e.target.checked }));
  byId('repo').addEventListener('change', e => save({ repo: e.target.value.trim() }));
  byId('checkUpdate').addEventListener('click', async () => {
    const name = byId('repo').value.trim();
    const status = byId('updateStatus');
    if (!/^[a-zA-Z\d_.-]+\/[a-zA-Z\d_.-]+$/.test(name)) { status.textContent = 'Enter owner/repo'; return; }
    status.textContent = 'Checking…';
    try {
      const response = await fetch(`https://api.github.com/repos/${name}/releases/latest`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const info = await response.json();
      const latest = String(info.tag_name || '').replace(/^v/, '');
      const installed = chrome.runtime.getManifest().version;
      status.textContent = latest === installed ? 'Up to date' : `Latest: v${latest}`;
      await save({ repo: name });
    } catch (error) { status.textContent = `Could not check (${error.message})`; }
  });
  chrome.tabs.onCreated.addListener(() => refresh().catch(console.error));
  chrome.tabs.onRemoved.addListener(() => refresh().catch(console.error));
  refresh().catch(console.error);
})();
