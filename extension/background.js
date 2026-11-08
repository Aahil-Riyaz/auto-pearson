'use strict';

const MODELS = Object.freeze({
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/*' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/*' },
  deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/*' }
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
  if (message.type === 'PEARSON_REQUEST') {
    if (!sender.tab?.id || !Number.isInteger(sender.frameId) || typeof message.question !== 'string') {
      respond({ ok: false, error: 'Invalid request source' }); return;
    }
    if (!/^https:\/\/(?:[^/]+\.)?(?:pearson\.com|pearsoncmg\.com|mathxl\.com|mylabmastering\.com)\//i.test(sender.url || '')) {
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
    chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 410, height: 730 });
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
