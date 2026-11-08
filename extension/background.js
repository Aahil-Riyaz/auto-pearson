'use strict';

const MODELS = Object.freeze({
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/*' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/*' },
  deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/*' }
});
// Limit tab control to Pearson homework windows. Never control an arbitrary tab.
const PEARSON_HOSTS = /(?:^|\.)(?:pearson\.com|pearsoncmg\.com|mathxl\.com|mylabmastering\.com)$/i;
const activeRuns = new Map();
const pendingVisuals = new Map();
const runKey = tabId => `run:${tabId}`;
async function restoreRun(tabId) {
  if (activeRuns.has(tabId)) return activeRuns.get(tabId);
  const item=await chrome.storage.session.get(runKey(tabId));
  const run=item[runKey(tabId)];
  if(run) activeRuns.set(tabId,run);
  return run||null;
}
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
// The captured image is cropped inside the Pearson top-level content script.
// Full-page bytes are never sent to an AI website.
const settle = ms => new Promise(r => setTimeout(r, ms));
async function captureQuestion(tabId, { preview = false } = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (!isHomework(tab.url || '')) throw new Error('Capture is restricted to a Pearson homework tab.');
  const selected = await chrome.tabs.query({active:true,windowId:tab.windowId});
  if (selected[0]?.id !== tabId) {
    await chrome.tabs.update(tabId,{active:true});
    await settle(450);
  }
  await ensureFrameScripts(tabId,0);
  await chrome.tabs.sendMessage(tabId,{type:'PEARSON_CAPTURE_VISIBILITY',hidden:true},{frameId:0}).catch(()=>{});
  try {
    await settle(180);
    let shot;
    try { shot = await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'}); }
    catch (e) { throw new Error(`Chrome could not capture this Pearson tab (${shortError(e)}). Click the extension icon while Pearson is active, then press Start there to grant screenshot access.`); }
    const crop = await chrome.tabs.sendMessage(tabId,{type:'PEARSON_CROP_IMAGE',shot},{frameId:0});
    if (!crop?.ok || !crop.image?.startsWith('data:image/')) throw new Error(crop?.error || 'Unable to crop the Pearson question screenshot.');
    if (preview) await chrome.storage.session.set({[`screenshot:${tabId}`]:crop.image});
    return {image:crop.image, crop:crop.rect};
  } finally {
    await chrome.tabs.sendMessage(tabId,{type:'PEARSON_CAPTURE_VISIBILITY',hidden:false},{frameId:0}).catch(()=>{});
  }
}

async function postStatus(tabId, message, count) {
  const was=lastStatus.get(tabId);
  await notify(tabId,message,Boolean(await restoreRun(tabId)),count===undefined ? (was?.count || 0) : count);
}

async function controlTab(tabId, action) {
  const tab = await chrome.tabs.get(tabId);
  if (!isHomework(tab.url || '')) return { ok:false, error:'Select a Pearson homework tab first.' };
  if (action === 'scan') return scanPearsonTab(tabId);
  if (action === 'preview') { const picture=await captureQuestion(tabId,{preview:true});return {ok:true,message:'Question screenshot is ready for preview.',rect:picture.crop}; }
  if (action === 'status') return { ok:true, ...(lastStatus.get(tabId) || {status:'Ready to scan Pearson frames.',isRunning:false}) };
  if (action === 'stop') {
    const run = await restoreRun(tabId);
    const frameIds = run ? [run.frameId] : (await findFrames(tabId)).found.map(f => f.frameId);
    await Promise.all(frameIds.map(frameId => chrome.tabs.sendMessage(tabId, {type:'PEARSON_STOP_FRAME'}, {frameId}).catch(() => {})));
    activeRuns.delete(tabId); await chrome.storage.session.remove(runKey(tabId));
    if (active?.tabId === tabId) { const job=active; active=null; await chrome.storage.session.remove('pearsonActiveJob'); if (job.aiTabId) chrome.tabs.sendMessage(job.aiTabId,{type:'PEARSON_AI_CANCEL',requestId:job.requestId}).catch(()=>{}); }
    for (let i=work.length-1;i>=0;i--) if (work[i].tabId===tabId) work.splice(i,1);
    await notify(tabId, 'Stopped.', false);
    return { ok:true, message:'Stopped.' };
  }
  if (action !== 'start') return {ok:false,error:'Unknown action'};
  if (await restoreRun(tabId)) {
    const run=activeRuns.get(tabId);
    try {await chrome.tabs.sendMessage(tabId,{type:'PEARSON_PROBE'}, {frameId:run.frameId});
      return {ok:false,error:'Already running. Use Stop to end it.'};}
    catch {activeRuns.delete(tabId);await chrome.storage.session.remove(runKey(tabId));}
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
    await chrome.storage.session.set({[runKey(tabId)]:activeRuns.get(tabId)});
    const result = await chrome.tabs.sendMessage(tabId, {type:'PEARSON_START_FRAME'}, {frameId:selected.frameId});
    if (!result?.ok) { activeRuns.delete(tabId);await chrome.storage.session.remove(runKey(tabId));return {ok:false,error:result?.error || 'Question frame rejected Start.'}; }
    await notify(tabId, `Running inside Pearson frame ${selected.frameId}. ${selected.type.replaceAll('_',' ')} detected.`, true);
    return {ok:true,message:`Started in frame ${selected.frameId} (${selected.type.replaceAll('_',' ')}).`,frameId:selected.frameId};
  } catch (error) {
    activeRuns.delete(tabId);await chrome.storage.session.remove(runKey(tabId));
    return {ok:false,error:`Question frame could not be started: ${shortError(error)}`};
  }
}
chrome.tabs.onRemoved.addListener(tabId => { activeRuns.delete(tabId);lastStatus.delete(tabId);revisions.delete(tabId);chrome.storage.session.remove(runKey(tabId)).catch(()=>{}); });
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0) { activeRuns.delete(details.tabId);lastStatus.delete(details.tabId);chrome.storage.session.remove(runKey(details.tabId)).catch(()=>{});return; }
  const run=activeRuns.get(details.tabId);
  if (run && run.frameId===details.frameId && run.documentId && run.documentId!==details.documentId) {
    activeRuns.delete(details.tabId);chrome.storage.session.remove(runKey(details.tabId)).catch(()=>{});notify(details.tabId,'Question frame navigated. Click Start again to resume safely.',false).catch(()=>{});
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
  const job=active;
  try {
    const { model = 'gemini' } = await chrome.storage.sync.get({model:'gemini'});
    const provider = MODELS[model] ?? MODELS.gemini;
    const matches = await chrome.tabs.query({ url: provider.url });
    const aiTab = matches.find(tab => tab.id !== job.tabId);
    if (!aiTab) throw new Error(`Open ${provider.name} in another browser tab and sign in.`);
    job.aiTabId = aiTab.id;
    await ensureFrameScripts(aiTab.id,0,'assistant');
    const {includeVisual=true}=await chrome.storage.sync.get({includeVisual:true});
    let screenshot=null;
    if (includeVisual) {
      await postStatus(job.tabId,'Capturing the current visible Pearson question…');
      const result=await captureQuestion(job.tabId);
      screenshot=result.image;
      if (!screenshot || screenshot.length < 2000) throw new Error('Question screenshot was empty or invalid.');
    }
    await postStatus(job.tabId,`Opening ${provider.name} and sending the ${screenshot ? 'screenshot + question' : 'question text'}…`);
    await chrome.storage.session.set({pearsonActiveJob:{tabId:job.tabId,frameId:job.frameId,requestId:job.requestId,aiTabId:job.aiTabId}});
    await chrome.tabs.update(aiTab.id,{active:true});
    await settle(350);
    if(active!==job) return;
    const accepted = await chrome.tabs.sendMessage(aiTab.id, {
      type: 'PEARSON_ASK', requestId: job.requestId, question: job.question, screenshot
    });
    if (!accepted?.ok) throw new Error(accepted?.error || `Unable to start ${provider.name}.`);
  } catch (error) {
    if(active!==job) return;
    active = null;
    await chrome.storage.session.remove('pearsonActiveJob');
    await chrome.tabs.update(job.tabId,{active:true}).catch(()=>{});
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
  if (message.type === 'PEARSON_TEST_AI') {
    (async()=>{
      const {model='gemini'}=await chrome.storage.sync.get({model:'gemini'});
      const provider=MODELS[model]||MODELS.gemini;
      const tabs=await chrome.tabs.query({url:provider.url});
      if(!tabs.length)throw new Error(`Open ${provider.name} in a signed-in tab.`);
      const result=await ensureFrameScripts(tabs[0].id,0,'assistant');
      return {ok:true,message:`${provider.name} content script connected.${result.busy?' It is processing another request.':''}`};
    })().then(respond).catch(e=>respond({ok:false,error:shortError(e)}));
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
    (async()=>{
      const tabId=sender.tab.id;
      // Pearson may render Check Answer in the exercise, another embedded player,
      // or the outer page. Find the actual enabled button, not a guessed frame.
      const frames=await findFrames(tabId);
      const preferred=[sender.frameId,0,...frames.found.map(f=>f.frameId)];
      const ids=[...new Set(preferred)];
      for(const frameId of ids){
        try{
          const result=await chrome.tabs.sendMessage(tabId,{type:'PEARSON_PAGE_CONTROL',action:message.action},{frameId});
          if(result?.ok) return {...result,frameId};
        }catch{}
      }
      return {ok:false,error:`No enabled ${message.action==='check'?'Check Answer':'Next/Continue'} control was found in any accessible Pearson frame.`};
    })().then(respond).catch(e=>respond({ok:false,error:shortError(e)}));
    return true;
  }
  if (message.type === 'PEARSON_PROGRESS') {
    if (!sender.tab || !isHomework(sender.tab.url || '')) {respond({ok:false});return;}
    restoreRun(sender.tab.id).then(async run=>{
      if(run && run.frameId===sender.frameId){
        if(!message.isRunning){ activeRuns.delete(sender.tab.id);await chrome.storage.session.remove(runKey(sender.tab.id)); }
        await notify(sender.tab.id,String(message.status||'').slice(0,300),Boolean(message.isRunning),Number(message.count)||0);
      }
      respond({ok:true});
    }).catch(e=>respond({ok:false,error:shortError(e)}));return true;
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
    restoreRun(sender.tab.id).then(run=>{
      if(!run||run.frameId!==sender.frameId){respond({ok:false,error:'Start the selected question frame first.'});return;}
      work.push({tabId:sender.tab.id,frameId:sender.frameId,requestId:message.requestId,question:message.question});
      respond({ok:true});pump();
    }).catch(e=>respond({ok:false,error:shortError(e)}));
    return true;
  }
  if (message.type === 'PEARSON_AI_STATUS') {
    if (active && active.requestId===message.requestId && sender.tab?.id===active.aiTabId) {
      postStatus(active.tabId,String(message.stage||'Working with AI…').slice(0,240)).catch(()=>{});
    }
    respond({ok:true});return;
  }
  if (message.type === 'PEARSON_AI_RESULT') {
    if (!active) {
      // A Manifest V3 service worker may have been suspended during generation.
      chrome.storage.session.get('pearsonActiveJob').then(({pearsonActiveJob:job}) => {
        if (!job || job.requestId!==message.requestId || sender.tab?.id!==job.aiTabId) {respond({ok:false,error:'Stale request'});return;}
        chrome.storage.session.remove('pearsonActiveJob').then(async()=>{
          await chrome.tabs.update(job.tabId,{active:true}).catch(()=>{});
          await answerToOrigin(job,{answer:message.answer,error:message.error});
          respond({ok:true});
        }).catch(e=>respond({ok:false,error:shortError(e)}));
      }).catch(e=>respond({ok:false,error:shortError(e)}));
      return true;
    }
    if (message.requestId !== active.requestId || sender.tab?.id !== active.aiTabId) {
      respond({ ok: false, error: 'No matching request' }); return;
    }
    const job = active;
    active = null;
    respond({ ok: true });
    (async () => {
      await chrome.storage.session.remove('pearsonActiveJob');
      await postStatus(job.tabId,message.error ? `AI problem: ${message.error}` : 'AI finished. Returning to Pearson…');
      await chrome.tabs.update(job.tabId,{active:true}).catch(()=>{});
      await settle(300);
      await answerToOrigin(job, { answer: message.answer, error: message.error });
    })().finally(pump);
    return;
  }
  if (message.type === 'PEARSON_OPEN_SETTINGS') {
    chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 640, height: 720 });
    respond({ ok: true });
    return;
  }
  if (message.type === 'PEARSON_CANCEL') {
    if (!sender.tab?.id) {respond({ok:false});return;}
    if (active && active.tabId === sender.tab.id && active.frameId === sender.frameId) {
      if(active.aiTabId) chrome.tabs.sendMessage(active.aiTabId,{type:'PEARSON_AI_CANCEL',requestId:active.requestId}).catch(()=>{});
      active = null;
      chrome.storage.session.remove('pearsonActiveJob').catch(()=>{});
      queueMicrotask(pump);
    }
    for (let i = work.length - 1; i >= 0; i--) {
      if (work[i].tabId === sender.tab.id && work[i].frameId === sender.frameId) work.splice(i, 1);
    }
    respond({ ok: true });
  }
});
