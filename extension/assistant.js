(() => {
  'use strict';
  if (window.__autoPearsonAssistant) return;
  window.__autoPearsonAssistant = true;
  const hostname = location.hostname;
  const model = hostname.includes('gemini') ? 'gemini' : hostname.includes('deepseek') ? 'deepseek' : 'chatgpt';
  const config = {
    chatgpt: {
      composer: ['#prompt-textarea', '[contenteditable="true"][data-testid*="prompt"]', 'textarea'],
      send: ['[data-testid="send-button"]', 'button[aria-label="Send prompt"]'],
      messages: ['[data-message-author-role="assistant"]', '[data-testid="conversation-turn-assistant"]']
    },
    gemini: {
      composer: ['.ql-editor[contenteditable="true"]', 'rich-textarea [contenteditable="true"]', '[contenteditable="true"]'],
      send: ['button[aria-label*="Send"]', '.send-button button', 'button[mattooltip*="Send"]'],
      messages: ['model-response', '.model-response-text', '.markdown']
    },
    deepseek: {
      composer: ['textarea', '[contenteditable="true"]'],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="send"]'],
      messages: ['.ds-markdown', '[class*="markdown"]']
    }
  }[model];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => !!node && node.getClientRects().length > 0;
  const firstVisible = selectors => {
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find(visible);
      if (found) return found;
    }
    return null;
  };
  const responses = () => [...document.querySelectorAll(config.messages.join(','))].filter(visible);
  const lastResponse = () => responses().at(-1)?.innerText?.trim() || '';
  const generating = () => !!document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop generating"],button[aria-label*="Stop response"]');
  function setText(el, value) {
    el.focus();
    if (el.matches('textarea,input')) {
      const descriptor = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
      descriptor.set.call(el, value);
    } else {
      // Browser-based chat editors use different rich-text engines. A native
      // insertText command often triggers the editor where assigning textContent does not.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = document.execCommand?.('insertText', false, value);
      if (!inserted) el.textContent = value;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function waitUntil(predicate, timeout = 12000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const output = predicate(); if (output) return output;
      await delay(250);
    }
    return null;
  }
  async function getAnswer(prompt) {
    const composer = await waitUntil(() => firstVisible(config.composer));
    if (!composer) throw new Error(`Unable to find the ${model} message composer. Check you're signed in.`);
    const before = lastResponse();
    const count = responses().length;
    setText(composer, prompt);
    const sendButton = await waitUntil(() => {
      const element = firstVisible(config.send);
      return element && !element.disabled ? element : null;
    }, 5000);
    if (sendButton && !sendButton.disabled) sendButton.click();
    else throw new Error(`Unable to find the ${model} send button. Its UI may have changed.`);
    await delay(900);
    let stable = 0, previous = '';
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      const current = lastResponse();
      const changed = responses().length > count || (current && current !== before);
      if (changed && current.length > 5 && !generating()) {
        if (current === previous) stable += 1; else stable = 0;
        if (stable >= 3) return current;
      } else stable = 0;
      previous = current;
      await delay(650);
    }
    throw new Error(`${model} didn't return a completed response. Its page layout may have changed.`);
  }
  let busy = false;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'PEARSON_ASK') return;
    if (busy) { sendResponse({ ok: false, error: 'AI tab is busy' }); return; }
    busy = true;
    sendResponse({ ok: true });
    getAnswer(msg.question)
      .then(answer => chrome.runtime.sendMessage({ type: 'PEARSON_AI_RESULT', requestId: msg.requestId, answer }))
      .catch(error => chrome.runtime.sendMessage({ type: 'PEARSON_AI_RESULT', requestId: msg.requestId, error: error.message }))
      .finally(() => { busy = false; });
  });
})();
