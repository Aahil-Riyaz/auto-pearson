'use strict';

const MODELS = Object.freeze({
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/*' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/*' },
  deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/*' }
});
// Limit tab control to Pearson homework windows. Never control an arbitrary tab.
const PEARSON_HOSTS = /(?:^|\.)(?:pearson\.com|pearsoncmg\.com|mathxl\.com|mylabmastering\.com)$/i;
const activeRuns = new Map();
const lastStatus = new Map();
const revisions = new Map();
const safePearsonUrl = url => {
  try { const u = new URL(url); return u.protocol === 'https:' && PEARSON_HOSTS.test(u.hostname); }
  catch { return false; }
};
const shortError = error => error?.message || String(error);
const isHomework = url => safePearsonUrl(url) && /homework/i.test(url);

async function ensureFrameScripts(tabId, frameId, origin = 'pearson') {
  const pingType = origin === 'assistant' ? 'PEARSON_AI_PING' : 'PEARSON_PROBE';
  const message = {type:pingType};
  const send = () => chrome.tabs.sendMessage(tabId, message, {frameId});
  try { const response = await send(); if (response?.ok) return response; } catch {}
  const files = origin === 'assistant' ? ['assistant.js'] : ['answer-utils.js','math.js','pearson.js'];
  await chrome.scripting.executeScript({ target:{tabId,frameIds:[frameId]},files });
  // Injection may finish before the frame's handlers are ready.
  for (let attempt=0;attempt<4;attempt++) {
    try { const response=await send(); if (response?.ok) return response; } catch {}
    await new Promise(resolve=>setTimeout(resolve,130*(attempt+1)));
  }
  throw new Error(`Script unavailable in ${origin} frame ${frameId}. Refresh the page or check site access for this extension.`);
}
async function findFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }) || [];
  const found = [];
  const missing = [];
  for (const frame of frames) {
    const approved = safePearsonUrl(frame.url) || /^about:(?:blank|srcdoc)$/i.test(frame.url);
    const origin = (()=>{try{return new URL(frame.url).origin;}catch{return 'embedded frame';}})();
    if (!approved) {missing.push({frameId:frame.frameId,origin,reason:'No Pearson host access for this origin'});continue;}
    try {
      const result = await ensureFrameScripts(tabId,frame.frameId);
      if (result?.ok) found.push({frameId:frame.frameId,documentId:frame.documentId,origin, ...result});
      else missing.push({frameId:frame.frameId,origin,reason:'Content script did not respond'});
    } catch(error) { missing.push({frameId:frame.frameId,origin,reason:shortError(error)}); }
  }
  return { found, missing, all:frames.map(f=>({frameId:f.frameId,origin:(()=>{try{return new URL(f.url).origin;}catch{return 'embedded frame';}})()})) };
}
function rankFrame(f) {
  if (!f.question) return -1;
  return (f.frameId !== 0 ? 20 : 0) + Math.min(12, f.controls || 0) + (f.type === 'unsupported' ? -20 : 30);
}
async function scanPearsonTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isHomework(tab.url || '')) return { ok: false, error: 'Open a Pearson MyLab homework tab first.' };
  const {found, missing, all} = await findFrames(tabId);
  const ranked = found.filter(f => f.question).sort((a,b) => rankFrame(b)-rankFrame(a));
  const selected = ranked[0] || null;
  const probed = found.map(({ frameId, origin, question, controls, type, math, excerpt, deterministic }) => ({ frameId, origin, question, controls, type, math, excerpt, deterministic }));
  return { ok: true, selected, frames: probed, missing, total: all.length };
}
async function notify(tabId, status, isRunning = false, count = 0) {
  const revision=(revisions.get(tabId)||0)+1; revisions.set(tabId,revision);
  lastStatus.set(tabId, { status, isRunning, count, revision });
  try {
    await ensureFrameScripts(tabId,0);
    await chrome.tabs.sendMessage(tabId, { type:'PEARSON_NOTIFY', status, isRunning, count, revision }, { frameId:0 });
  } catch(error) {console.debug('[Auto-Pearson] Toolbar not reachable:',shortError(error));}
}
async function controlTab(tabId, action) {
  const tab = await chrome.tabs.get(tabId);
  if (!isHomework(tab.url || '')) return { ok:false, error:'Select a Pearson homework tab first.' };
  if (action === 'scan') return scanPearsonTab(tabId);
  if (action === 'status') return { ok:true, ...(lastStatus.get(tabId) || {status:'Ready to scan Pearson frames.',isRunning:false}) };
  if (action === 'stop') {
    const run = activeRuns.get(tabId);
    const frameIds = run ? [run.frameId] : (await findFrames(tabId)).found.map(f => f.frameId);
    await Promise.all(frameIds.map(frameId => chrome.tabs.sendMessage(tabId, {type:'PEARSON_STOP_FRAME'}, {frameId}).catch(() => {})));
    activeRuns.delete(tabId);
    await notify(tabId, 'Stopped.', false);
    return { ok:true, message:'Stopped.' };
  }
  if (action !== 'start') return {ok:false,error:'Unknown action'};
  if (activeRuns.has(tabId)) {
    const run=activeRuns.get(tabId);
    try {await chrome.tabs.sendMessage(tabId,{type:'PEARSON_PROBE'}, {frameId:run.frameId});
      return {ok:false,error:'Already running. Use Stop to end it.'};}
    catch {activeRuns.delete(tabId);}
  }
  const scan = await scanPearsonTab(tabId);
  if (!scan.ok) return scan;
  if (!scan.selected) {
    const missingOrigins = [...new Set(scan.missing.map(f => f.origin))].slice(0, 4).join(', ');
    const message = scan.frames.length
      ? `Scanned ${scan.frames.length} Pearson frame(s), but none exposed a supported question. ${missingOrigins ? `Other frame origins: ${missingOrigins}.` : 'Custom radio/math widgets may require a dedicated adapter.'}`
      : `No readable Pearson question frame found. ${missingOrigins ? `Embedded origins: ${missingOrigins}.` : 'Refresh this homework tab after installing.'}`;
    await notify(tabId, message, false);
    return {ok:false, error:message, scan};
  }
  const selected = scan.selected;
  try {
    await ensureFrameScripts(tabId,selected.frameId);
    activeRuns.set(tabId, {frameId:selected.frameId, documentId:selected.documentId});
    const result = await chrome.tabs.sendMessage(tabId, {type:'PEARSON_START_FRAME'}, {frameId:selected.frameId});
    if (!result?.ok) { activeRuns.delete(tabId);return {ok:false,error:result?.error || 'Question frame rejected Start.'}; }
    await notify(tabId, `Running inside Pearson frame ${selected.frameId}. ${selected.type.replaceAll('_',' ')} detected.`, true);
    return {ok:true,message:`Started in frame ${selected.frameId} (${selected.type.replaceAll('_',' ')}).`,frameId:selected.frameId};
  } catch (error) {
    activeRuns.delete(tabId);
    return {ok:false,error:`Question frame could not be started: ${shortError(error)}`};
  }
}
chrome.tabs.onRemoved.addListener(tabId => { activeRuns.delete(tabId);lastStatus.delete(tabId);revisions.delete(tabId); });
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0) { activeRuns.delete(details.tabId);lastStatus.delete(details.tabId);return; }
  const run=activeRuns.get(details.tabId);
  if (run && run.frameId===details.frameId && run.documentId && run.documentId!==details.documentId) {
    activeRuns.delete(details.tabId);notify(details.tabId,'Question frame navigated. Click Start again to resume safely.',false).catch(()=>{});
  }
});

const work = [];
let active = null;

async function answerToOrigin(job, response) {
  try {
    await chrome.tabs.sendMessage(job.tabId, { type: 'PEARSON_REPLY', requestId: job.requestId, ...response }, { frameId: job.frameId });
  } catch (error) {
    console.warn('[Auto-Pearson] Unable to reach question tab:', error);
  }
}

async function pump() {
  if (active || !work.length) return;
  active = work.shift();
  try {
    const { model = 'chatgpt' } = await chrome.storage.sync.get('model');
    const provider = MODELS[model] ?? MODELS.chatgpt;
    const matches = await chrome.tabs.query({ url: provider.url });
    const aiTab = matches.find(tab => tab.id !== active.tabId);
    if (!aiTab) throw new Error(`Open ${provider.name} in another browser tab and sign in.`);
    active.aiTabId = aiTab.id;
    await ensureFrameScripts(aiTab.id,0,'assistant');
    const {includeVisual=false}=await chrome.storage.sync.get({includeVisual:false});
    let screenshot=null;
    if (includeVisual) {
      const key=`screenshot:${active.tabId}`;
      const saved=await chrome.storage.session.get(key);screenshot=saved[key]||null;
      if (screenshot) await chrome.storage.session.remove(key); // one-time use; never silently attach to a later question
    }
    const accepted = await chrome.tabs.sendMessage(aiTab.id, {
      type: 'PEARSON_ASK', requestId: active.requestId, question: active.question, screenshot
    });
    if (!accepted?.ok) throw new Error(accepted?.error || `Unable to start ${provider.name}.`);
  } catch (error) {
    const job = active;
    active = null;
    await answerToOrigin(job, { error: error.message || String(error) });
    pump();
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'PEARSON_CONTROL') {
    const tabId = sender.tab?.id ?? message.tabId;
    if (!Number.isInteger(tabId)) { respond({ok:false,error:'No Pearson tab specified.'});return; }
    // Restrict calls from content scripts to their own tabs. A popup can use a selected tab ID.
    if (sender.tab && sender.tab.id !== tabId) { respond({ok:false,error:'Cannot control another tab.'});return; }
    controlTab(tabId, message.action).then(respond).catch(e => respond({ok:false,error:shortError(e)}));
    return true;
  }
  if (message.type === 'PEARSON_VISUAL_STATUS') {
    if (!sender.tab?.id || !isHomework(sender.tab.url || '')) {respond({ok:false});return;}
    chrome.storage.session.get(`screenshot:${sender.tab.id}`).then(items => respond({ok:true,available:!!items[`screenshot:${sender.tab.id}`]})).catch(()=>respond({ok:false}));
    return true;
  }
  if (message.type === 'PEARSON_PAGE_ACTION') {
    if (!sender.tab?.id || !isHomework(sender.tab.url || '') || !['check','next','status'].includes(message.action)) {
      respond({ok:false,error:'Not an approved Pearson homework action.'});return;
    }
    ensureFrameScripts(sender.tab.id,0).then(()=>chrome.tabs.sendMessage(sender.tab.id, {type:'PEARSON_PAGE_CONTROL',action:message.action}, {frameId:0}))
      .then(respond).catch(e => respond({ok:false,error:shortError(e)}));
    return true;
  }
  if (message.type === 'PEARSON_PROGRESS') {
    if (sender.tab && isHomework(sender.tab.url || '')) {
      const run=activeRuns.get(sender.tab.id);
      if (run && run.frameId === sender.frameId) {
        if (!message.isRunning) activeRuns.delete(sender.tab.id);
        notify(sender.tab.id, String(message.status || '').slice(0,300), Boolean(message.isRunning), Number(message.count)||0);
      }
    }
    respond({ok:true});return;
  }
  if (message.type === 'PEARSON_REQUEST') {
    if (!sender.tab?.id || !Number.isInteger(sender.frameId) || typeof message.question !== 'string') {
      respond({ ok: false, error: 'Invalid request source' }); return;
    }
    if (!safePearsonUrl(sender.url || '') && !(isHomework(sender.tab.url || '') && /^about:(blank|srcdoc)$/i.test(sender.url || ''))) {
      respond({ ok: false, error: 'Not an approved Pearson page' }); return;
    }
    if (!message.requestId || message.question.length > 12000) {
      respond({ ok: false, error: 'Invalid question data' }); return;
    }
    const run=activeRuns.get(sender.tab.id);
    if (!run || run.frameId!==sender.frameId) {respond({ok:false,error:'Start the selected question frame first.'});return;}
    work.push({ tabId: sender.tab.id, frameId: sender.frameId, requestId: message.requestId, question: message.question });
    respond({ ok: true });
    pump();
    return;
  }
  if (message.type === 'PEARSON_AI_RESULT') {
    if (!active || message.requestId !== active.requestId || sender.tab?.id !== active.aiTabId) {
      respond({ ok: false, error: 'No matching request' }); return;
    }
    const job = active;
    active = null;
    respond({ ok: true });
    answerToOrigin(job, { answer: message.answer, error: message.error }).finally(pump);
    return;
  }
  if (message.type === 'PEARSON_OPEN_SETTINGS') {
    chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 530, height: 620 });
    respond({ ok: true });
    return;
  }
  if (message.type === 'PEARSON_CANCEL') {
    if (!sender.tab?.id) {respond({ok:false});return;}
    if (active && active.tabId === sender.tab.id && active.frameId === sender.frameId) {
      active = null;
      queueMicrotask(pump);
    }
    for (let i = work.length - 1; i >= 0; i--) {
      if (work[i].tabId === sender.tab.id && work[i].frameId === sender.frameId) work.splice(i, 1);
    }
    respond({ ok: true });
  }
});
