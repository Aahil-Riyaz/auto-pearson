(() => {
  'use strict';
  const DEFAULTS = { model: 'gemini', pauseBeforeSubmit: true, autoAdvance: true, includeVisual: true, repo: '' };
  const models = { chatgpt: 'https://chatgpt.com/*', gemini: 'https://gemini.google.com/*', deepseek: 'https://chat.deepseek.com/*' };
  const byId = id => document.getElementById(id);
  let saveTimeout;
  let pearsonTabId = null;
  const pearsonPatterns = [
    'https://*.pearson.com/*','https://*.pearsoncmg.com/*','https://*.mathxl.com/*','https://*.mylabmastering.com/*'
  ];
  const isHomeworkTab = tab => !!tab?.url && /homework/i.test(tab.url) && /^https:\/\//i.test(tab.url) && /\.(pearson\.com|pearsoncmg\.com|mathxl\.com|mylabmastering\.com)\//i.test(tab.url);
  async function locateTab() {
    const active = await chrome.tabs.query({active:true,currentWindow:true});
    let tab = active.find(isHomeworkTab);
    if (!tab) {
      const all = await chrome.tabs.query({url:pearsonPatterns});
      tab = all.filter(isHomeworkTab).sort((a,b) => (b.lastAccessed||0)-(a.lastAccessed||0))[0];
    }
    pearsonTabId = tab?.id ?? null;
    byId('tabName').textContent = tab ? `${tab.title || 'Pearson homework'} (tab ${tab.id})` : 'No Pearson homework tab found. Open an assignment and refresh it.';
    for (const key of ['start','stop','scan']) byId(key).disabled = !tab;
    return tab;
  }
  async function command(action) {
    const status=byId('runStatus');
    if (!pearsonTabId) {status.textContent='Open Pearson homework first.';return;}
    status.textContent = action === 'scan' ? 'Scanning Pearson frames…' : action === 'preview' ? 'Capturing question area…' : `${action === 'stop' ? 'Stopping' : 'Starting'}…`;
    try {
      const result=await chrome.runtime.sendMessage({type:'PEARSON_CONTROL',action,tabId:pearsonTabId});
      if (action === 'scan' && result?.ok) {
        status.textContent=result.selected ? `Detected: ${result.selected.type.replaceAll('_',' ')} in frame ${result.selected.frameId}. ${result.selected.controls} answer controls.` : 'No supported question detected in accessible Pearson frames.';
        const frames = result.frames.map(f=> `Frame ${f.frameId}: ${f.origin} · ${f.controls} control(s) · ${f.question ? f.type : 'no recognized question'} · Math ${f.math?.formulas || 0} (${f.math?.unreadable || 0} unreadable)${f.deterministic ? ` · Verified ${f.deterministic}%` : ''}\n${f.excerpt?.slice(0,200)||''}`);
        const missing = result.missing.map(f=> `Unreachable frame ${f.frameId}: ${f.origin} · ${f.reason||'Blocked'}`);
        byId('frameStatus').textContent=[...frames,...missing].slice(0,12).join('\n');
        byId('frameStatus').style.whiteSpace='pre-wrap';
      } else { status.textContent=result?.error || result?.message || 'No response from extension.'; if(action === 'preview' && result?.ok) await refreshCapture(); }
    } catch(error) { status.textContent=`Extension error: ${error.message}`; }
  }

  async function refreshCapture() {
    if (!pearsonTabId) return;
    const item=await chrome.storage.session.get(`screenshot:${pearsonTabId}`);
    const source=item[`screenshot:${pearsonTabId}`];
    const preview=byId('capturePreview');
    preview.style.display=source?'block':'none';
    preview.src=source||'';
    byId('captureStatus').textContent=source?'This is the crop sent with every new question. Check that the complete formula and answer choices are visible.':'No preview captured yet. Vision mode automatically captures when you press Start.';
  }
  byId('capture').addEventListener('click',()=>command('preview'));
  byId('clearCapture').addEventListener('click',async()=>{
    if (pearsonTabId) await chrome.storage.session.remove(`screenshot:${pearsonTabId}`);
    await refreshCapture();
  });
  byId('testAI').addEventListener('click', async()=>{
    try {
      const result=await chrome.runtime.sendMessage({type:'PEARSON_TEST_AI'});
      byId('aiStatus').textContent=result?.error||result?.message||'No connection response.';
    } catch(error){byId('aiStatus').textContent=error.message;}
  });

  for (const action of ['start','stop','scan']) byId(action).addEventListener('click',()=>command(action));
  byId('version').textContent = 'v'+chrome.runtime.getManifest().version;
  locateTab().then(async () => {
    if (pearsonTabId) {
      await refreshCapture();
      const result = await chrome.runtime.sendMessage({type:'PEARSON_CONTROL',action:'status',tabId:pearsonTabId});
      if (result?.ok) byId('runStatus').textContent = result.status;
    }
  }).catch(e => byId('runStatus').textContent=e.message);
  async function refresh() {
    const state = await chrome.storage.sync.get(DEFAULTS);
    const selected = document.querySelector(`input[name="model"][value="${state.model}"]`);
    if (selected) selected.checked = true;
    for (const key of ['pauseBeforeSubmit', 'autoAdvance', 'includeVisual']) byId(key).checked = Boolean(state[key]);
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
    saveTimeout = setTimeout(() => byId('saveStatus').textContent = 'Settings are saved with Chrome sync.', 2500);
  };
  document.querySelectorAll('input[name="model"]').forEach(el => el.addEventListener('change', () => save({ model: el.value })));
  for (const key of ['pauseBeforeSubmit', 'autoAdvance', 'includeVisual']) byId(key).addEventListener('change', e => save({ [key]: e.target.checked }));
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
