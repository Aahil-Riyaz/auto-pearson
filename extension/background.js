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
const safePearsonUrl = url => {
  try { const u = new URL(url); return u.protocol === 'https:' && PEARSON_HOSTS.test(u.hostname); }
  catch { return false; }
};
const shortError = error => error?.message || String(error);
const isHomework = url => safePearsonUrl(url) && /homework/i.test(url);

async function findFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }) || [];
  const found = [];
  for (const frame of frames) {
    // about:blank/srcdoc can inherit a Pearson initiator; Chrome also controls
    // matching using match_origin_as_fallback, never broad all-sites access.
    const approved = safePearsonUrl(frame.url) || /^about:(?:blank|srcdoc)$/i.test(frame.url);
    if (!approved) continue;
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'PEARSON_PROBE' }, { frameId: frame.frameId });
      if (result?.ok) found.push({ frameId: frame.frameId, origin: result.origin, ...result });
    } catch { /* No script in this frame; do not use page-level JS or CDP to bypass it. */ }
  }
  return { found, all: frames.map(f => ({ frameId: f.frameId, origin: (() => {try {return new URL(f.url).origin;} catch {return 'embedded frame';}})() })) };
}
function rankFrame(f) {
  if (!f.question) return -1;
  return (f.frameId !== 0 ? 20 : 0) + Math.min(12, f.controls || 0) + (f.type === 'unsupported' ? -20 : 30);
}
async function scanPearsonTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isHomework(tab.url || '')) return { ok: false, error: 'Open a Pearson MyLab homework tab first.' };
  // User-initiated scan: reattach scripts to permitted frames on an already-open
  // Pearson tab. Chrome itself enforces each frame's origin permission. Never
  // inject scripts into other browser tabs or request unrestricted host access.
  try {
    await chrome.scripting.executeScript({target:{tabId,allFrames:true},files:['answer-utils.js','pearson.js']});
  } catch (error) {
    console.info('[Auto-Pearson] Some frames cannot be inspected with granted host permissions:', error.message);
  }
  const { found, all } = await findFrames(tabId);
  const ranked = found.filter(f => f.question).sort((a,b) => rankFrame(b)-rankFrame(a));
  const selected = ranked[0] || null;
  const probed = found.map(({ frameId, origin, question, controls, type }) => ({ frameId, origin, question, controls, type }));
  const missing = all.filter(f => !found.some(p => p.frameId === f.frameId));
  return { ok: true, selected, frames: probed, missing, total: all.length };
}
async function notify(tabId, status, isRunning = false) {
  lastStatus.set(tabId, { status, isRunning });
  try { await chrome.tabs.sendMessage(tabId, { type:'PEARSON_NOTIFY', status, isRunning }, { frameId:0 }); } catch {}
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
  if (activeRuns.has(tabId)) return {ok:false,error:'Already running. Use Stop to end it.'};
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
    const result = await chrome.tabs.sendMessage(tabId, {type:'PEARSON_START_FRAME'}, {frameId:selected.frameId});
    if (!result?.ok) return {ok:false,error:result?.error || 'Question frame rejected Start.'};
    activeRuns.set(tabId, {frameId:selected.frameId});
    await notify(tabId, `Running inside Pearson frame ${selected.frameId}. ${selected.type.replaceAll('_',' ')} detected.`, true);
    return {ok:true,message:`Started in frame ${selected.frameId} (${selected.type.replaceAll('_',' ')}).`,frameId:selected.frameId};
  } catch (error) {
    return {ok:false,error:`Question frame could not be started: ${shortError(error)}`};
  }
}
chrome.tabs.onRemoved.addListener(tabId => { activeRuns.delete(tabId);lastStatus.delete(tabId); });

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
    const accepted = await chrome.tabs.sendMessage(aiTab.id, {
      type: 'PEARSON_ASK', requestId: active.requestId, question: active.question
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
  if (message.type === 'PEARSON_PAGE_ACTION') {
    if (!sender.tab?.id || !isHomework(sender.tab.url || '') || !['check','next','status'].includes(message.action)) {
      respond({ok:false,error:'Not an approved Pearson homework action.'});return;
    }
    chrome.tabs.sendMessage(sender.tab.id, {type:'PEARSON_PAGE_CONTROL',action:message.action}, {frameId:0})
      .then(respond).catch(e => respond({ok:false,error:shortError(e)}));
    return true;
  }
  if (message.type === 'PEARSON_PROGRESS') {
    if (sender.tab && safePearsonUrl(sender.tab.url || '')) {
      if (!message.isRunning) activeRuns.delete(sender.tab.id);
      notify(sender.tab.id, String(message.status || '').slice(0,300), Boolean(message.isRunning));
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
    if (!sender.tab?.id) return;
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
