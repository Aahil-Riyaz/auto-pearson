(() => {
  'use strict';
  if (window.__autoPearsonLoaded) return;
  window.__autoPearsonLoaded = true;

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const { parseAnswer, choiceIndex, normalize } = PearsonAnswer;
  const DEFAULTS = { model: 'chatgpt', pauseBeforeSubmit: true, autoAdvance: false, };
  const state = { running: false, generation: 0, count: 0, errors: 0, currentRequest: null, resolveRequest: null };
  let options = { ...DEFAULTS };
  let host, statusEl, startBtn, countEl;

  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const textOf = e => (e?.innerText || e?.textContent || '').replace(/\s+/g, ' ').trim();
  const buttons = () => [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')].filter(visible);
  const buttonLabel = b => textOf(b) || b.value || b.getAttribute('aria-label') || b.title || '';
  const findButton = pattern => buttons().find(b => pattern.test(buttonLabel(b).trim()) && !b.disabled);
  const findCheck = () => findButton(/^(check\s*answer|final\s*check|check)$/i);
  const findNext = () => findButton(/^(continue|next|next\s*question|next\s*part|go to next question)$/i);
  const problemControls = () => [...document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="button"]):not([type="submit"]):not([type="search"]), textarea, select, [contenteditable="true"]')]
    .filter(e => visible(e) && !e.disabled && !e.closest('header,nav,[role="navigation"],#auto-pearson-widget'));

  function isAssessment() {
    const heading = [...document.querySelectorAll('h1,h2,[role="heading"]')].slice(0, 5).map(textOf).join(' ');
    const path = location.pathname;
    return /(quiz|exam|proctored)/i.test(heading + ' ' + path) && !/homework/i.test(heading + ' ' + path);
  }

  function rootFor(controls) {
    const candidates = [...document.querySelectorAll('[data-testid*="question" i], [id*="question" i], [class*="question" i], [class*="problem" i], [id*="exercise" i], [class*="exercise" i], article, main, [role="main"]')]
      .filter(visible)
      .filter(e => controls.some(c => e.contains(c)))
      .filter(e => textOf(e).length >= 12 && textOf(e).length <= 10000);
    // Pick a smallest reasonable question panel, not the entire course or gradebook.
    candidates.sort((a, b) => textOf(a).length - textOf(b).length);
    for (const candidate of candidates) {
      const count = controls.filter(c => candidate.contains(c)).length;
      const firstCount = controls[0]?.type === 'radio' ? controls.filter(c => c.type === 'radio').length : 1;
      if (count >= Math.min(firstCount, 2)) return candidate;
    }
    // A conservative ancestor fallback: no full-page scraping.
    let node = controls[0]?.parentElement;
    for (let level = 0; node && level < 6; level++, node = node.parentElement) {
      const size = textOf(node).length;
      if (size >= 60 && size <= 6000 && controls.filter(c => node.contains(c)).length >= Math.min(controls.length, 2)) return node;
    }
    return null;
  }

  function describeInput(el, index) {
    const id = el.id && CSS.escape(el.id);
    const label = (el.closest('label') || (id && document.querySelector(`label[for="${id}"]`)));
    const adjacent = label || el.parentElement;
    let content = textOf(adjacent).slice(0, 240);
    if (!content) content = el.getAttribute('aria-label') || el.placeholder || `Option ${index + 1}`;
    return content;
  }

  function extractQuestion() {
    const controls = problemControls();
    if (!controls.length) return null;
    const root = rootFor(controls);
    if (!root) return null;
    const fields = controls.filter(c => root.contains(c));
    const radio = fields.filter(c => c.type === 'radio');
    const checkboxes = fields.filter(c => c.type === 'checkbox');
    const selects = fields.filter(c => c.tagName === 'SELECT');
    const texts = fields.filter(c => (['text', 'number', 'tel'].includes(c.type) || c.tagName === 'TEXTAREA' || c.isContentEditable));
    const type = radio.length ? 'multiple_choice' : checkboxes.length ? 'multiple_select' : selects.length ? 'matching_or_dropdown' : texts.length ? 'fill_in_the_blank' : 'unsupported';
    const activeFields = radio.length ? radio : checkboxes.length ? checkboxes : selects.length ? selects : texts;
    const clone = root.cloneNode(true);
    clone.querySelectorAll('button, nav, script, style, [role="navigation"], input, textarea, select, [contenteditable="true"]').forEach(e => e.remove());
    const question = textOf(clone).slice(0, 6000);
    const fieldLabels = activeFields.map(describeInput);
    const selectOptions = selects.map(select => [...select.options].filter(o => o.value && !/^(select|choose)/i.test(o.textContent.trim())).map(o => o.textContent.trim()));
    const signature = normalize(question.slice(0, 1200) + '|' + fieldLabels.join('|')).slice(0, 1600);
    if (!question || !signature || !activeFields.length) return null;
    return { root, fields: activeFields, type, question, labels: fieldLabels, selectOptions, signature };
  }

  function promptFor(q) {
    const payload = {
      type: q.type,
      question: q.question,
      options: ['multiple_choice', 'multiple_select'].includes(q.type) ? q.labels.map((label, i) => `${i + 1}. ${label}`) : [],
      dropdownOptions: q.selectOptions,
      fieldCount: q.fields.length
    };
    return `Solve the following practice/homework problem carefully. Work out the reasoning but provide a concise final answer. Do not invent missing information.\n\n${JSON.stringify(payload)}\n\nRespond with exactly one JSON object of the form {"answers":["exact answer or exact option label"],"explanation":"short justification"}. For multiple select include every selected option. For multiple blanks and dropdowns, return one answer PER FIELD in order. If uncertain, use {"answers":[],"explanation":"why uncertain"}. Do not include markdown fences.`;
  }

  function setField(el, value) {
    el.focus();
    if (el.isContentEditable) el.textContent = value;
    else {
      const owner = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(owner, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectField(el, checked) {
    if (el.checked === checked) return;
    el.click(); // Use native click so Pearson frameworks receive their handlers.
  }

  function apply(q, answers) {
    if (!answers.length) return { ok: false, reason: 'No reliable AI answer was returned.' };
    if (q.type === 'multiple_choice') {
      const index = choiceIndex(answers[0], q.labels);
      if (index < 0) return { ok: false, reason: `Couldn't match "${answers[0]}" to a choice.` };
      selectField(q.fields[index], true);
      return { ok: true };
    }
    if (q.type === 'multiple_select') {
      const indexes = answers.map(a => choiceIndex(a, q.labels));
      if (indexes.some(i => i < 0)) return { ok: false, reason: 'Could not match every checkbox answer.' };
      q.fields.forEach((el, i) => selectField(el, indexes.includes(i)));
      return { ok: true };
    }
    if (q.type === 'fill_in_the_blank') {
      if (answers.length !== q.fields.length) return { ok: false, reason: `Expected ${q.fields.length} blanks but received ${answers.length}.` };
      q.fields.forEach((el, i) => setField(el, answers[i]));
      return { ok: true };
    }
    if (q.type === 'matching_or_dropdown') {
      if (answers.length !== q.fields.length) return { ok: false, reason: 'Dropdown answer count mismatch.' };
      for (let i = 0; i < q.fields.length; i++) {
        const el = q.fields[i];
        const desired = normalize(answers[i]);
        const opt = [...el.options].find(o => normalize(o.textContent) === desired) || el.options[choiceIndex(answers[i], [...el.options].map(o => o.textContent))];
        if (!opt) return { ok: false, reason: `No option matches dropdown answer ${i + 1}.` };
        setField(el, opt.value);
      }
      return { ok: true };
    }
    return { ok: false, reason: 'Unsupported question widget (for example drag-and-drop or a math editor).' };
  }

  function updateUI(message) {
    if (statusEl) statusEl.textContent = message;
    if (countEl) countEl.textContent = `${state.count} filled`;
    if (startBtn) startBtn.textContent = state.running ? 'Stop' : 'Start';
  }
  function stop(message = 'Stopped') {
    state.running = false;
    state.generation++;
    if (state.resolveRequest) {
      state.resolveRequest({ error: 'Cancelled' });
      state.resolveRequest = null;
    }
    chrome.runtime.sendMessage({ type: 'PEARSON_CANCEL' }).catch(() => {});
    updateUI(message);
  }
  const stillRunning = generation => state.running && generation === state.generation;
  async function waitFor(predicate, generation, timeout = Infinity, interval = 350) {
    const until = Date.now() + timeout;
    while (stillRunning(generation) && Date.now() < until) {
      const value = predicate(); if (value) return value;
      await delay(interval);
    }
    return null;
  }

  async function askAI(question, generation) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise(async resolve => {
      const onTimeout = setTimeout(() => { if (state.currentRequest === id) { state.currentRequest = null; state.resolveRequest = null; resolve({ error: 'AI response timed out.' }); } }, 190000);
      state.currentRequest = id;
      state.resolveRequest = output => { clearTimeout(onTimeout); state.currentRequest = null; state.resolveRequest = null; resolve(output); };
      try {
        const result = await chrome.runtime.sendMessage({ type: 'PEARSON_REQUEST', requestId: id, question });
        if (!result?.ok) state.resolveRequest?.({ error: result?.error || 'Background service rejected the question.' });
      } catch (error) { state.resolveRequest?.({ error: error.message }); }
    });
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'PEARSON_REPLY' && msg.requestId === state.currentRequest) state.resolveRequest?.(msg);
  });

  function feedbackText() {
    return [...document.querySelectorAll('[role="alert"], [aria-live="polite"], [aria-live="assertive"], [class*="feedback" i], [class*="correctness" i]')]
      .filter(visible).map(textOf).join(' ').slice(0, 600);
  }

  async function handleSubmission(q, generation) {
    const check = findCheck();
    if (!check) { updateUI('Fields filled. Check Answer not found; submit manually.'); return waitFor(() => extractQuestion()?.signature !== q.signature, generation); }
    const before = feedbackText();
    check.click();
    updateUI('Checking answer…');
    await delay(1000);
    const result = await waitFor(() => {
      const next = extractQuestion();
      if (next && next.signature !== q.signature) return 'changed';
      const f = feedbackText();
      if (f && f !== before) return f;
      const button = findNext();
      if (button && !findCheck()) return 'next';
      return null;
    }, generation, 10000);
    if (!stillRunning(generation)) return;
    if (typeof result === 'string' && /(incorrect|not\s+correct|try\s+again|wrong)/i.test(result)) {
      stop('Pearson marked the answer incorrect. Review manually; no retries were used.'); return;
    }
    if (result === 'changed') return;
    if (options.autoAdvance) {
      const next = findNext();
      if (next && !findCheck()) { next.click(); return; }
    }
    updateUI('Submitted. Use Next/Continue to proceed.');
    await waitFor(() => extractQuestion()?.signature !== q.signature, generation);
  }

  async function loop(generation) {
    let last = '';
    while (stillRunning(generation)) {
      const q = await waitFor(extractQuestion, generation, 12000);
      if (!stillRunning(generation)) return;
      if (!q) { stop('Could not identify a supported question. Use manual mode.'); return; }
      if (last === q.signature) {
        updateUI('Waiting for the next part or question…');
        const next = await waitFor(() => extractQuestion()?.signature !== last, generation, 45000);
        if (!next) { stop('The question did not change. Continue manually if needed.'); return; }
        continue;
      }
      last = q.signature;
      updateUI(`Asking ${options.model} about a ${q.type.replace(/_/g, ' ')} question…`);
      const reply = await askAI(promptFor(q), generation);
      if (!stillRunning(generation)) return;
      if (reply.error) { stop(reply.error); return; }
      const answer = parseAnswer(reply.answer);
      const current = extractQuestion();
      if (!current || current.signature !== q.signature) {
        updateUI('Question changed while AI was answering; retrying current question.');
        last = ''; continue;
      }
      const outcome = apply(current, answer.answers);
      if (!outcome.ok) {
        stop(`Manual action needed: ${outcome.reason} AI response: ${answer.answers.join(' | ').slice(0, 250)}`); return;
      }
      state.count++;
      updateUI('Answer filled. ' + (options.pauseBeforeSubmit ? 'Review it and click Check Answer yourself.' : 'Submitting…'));
      if (options.pauseBeforeSubmit) {
        await waitFor(() => {
          const latest = extractQuestion();
          return !findCheck() || (latest && latest.signature !== q.signature);
        }, generation);
        // Never click Check Answer when user review is enabled.
      } else {
        await handleSubmission(q, generation);
      }
    }
  }

  async function start() {
    if (state.running) return stop();
    if (isAssessment()) { updateUI('Auto mode is disabled on quizzes and exams.'); return; }
    const q = extractQuestion();
    if (!q) { updateUI('No supported problem detected in this frame. Open a homework question.'); return; }
    options = { ...DEFAULTS, ...await chrome.storage.sync.get(DEFAULTS) };
    if (!confirm(`Start Auto-Pearson using ${options.model}? Question text will be sent to that AI tab. AI answers may be wrong. ${options.pauseBeforeSubmit ? 'You will review and submit each answer.' : 'Check Answer will be clicked automatically.'}`)) return;
    state.running = true;
    state.generation++;
    const generation = state.generation;
    updateUI('Starting…');
    loop(generation).catch(error => { console.error(error); stop(`Unexpected error: ${error.message}`); });
  }

  function createWidget() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'auto-pearson-widget';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      *{box-sizing:border-box} .card{width:270px;background:#132036;color:#edf3ff;border:1px solid #334866;border-radius:15px;padding:14px;box-shadow:0 9px 30px #0005;font:13px/1.45 system-ui,Arial,sans-serif}
      .top{display:flex;justify-content:space-between;align-items:center;gap:8px}.name{font-weight:750;font-size:15px}.sub{font-size:11px;color:#a8b7d5}
      .buttons{display:flex;gap:7px;margin:10px 0}.buttons button{cursor:pointer;border:0;border-radius:8px;font-weight:700;padding:7px 10px}.start{background:#7dc7ff;color:#0b1930;flex:1}.settings{background:#30425d;color:white}
      .status{font-size:12px;color:#d8e8fb;min-height:32px;overflow-wrap:anywhere}.tiny{margin-top:8px;color:#a8b7d5;font-size:11px}
      </style><section class="card" role="region" aria-label="Auto Pearson controls"><div class="top"><div><div class="name">Auto-Pearson</div><div class="sub">Experimental MyLab helper</div></div><div class="sub" id="count">0 filled</div></div><div class="buttons"><button class="start" id="start">Start</button><button class="settings" id="settings">Settings</button></div><div class="status" id="status">Ready when your homework question is open.</div><div class="tiny">Use Stop any time. Review AI answers carefully.</div></section>`;
    (document.body || document.documentElement).appendChild(host);
    statusEl = shadow.getElementById('status');
    startBtn = shadow.getElementById('start');
    countEl = shadow.getElementById('count');
    startBtn.addEventListener('click', start);
    shadow.getElementById('settings').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'PEARSON_OPEN_SETTINGS' }));
  }

  // Pearson embeds some players in same-origin or separate frames; only a frame with a problem shows controls.
  const observer = new MutationObserver(() => {
    if (!host && !isAssessment() && extractQuestion()) createWidget();
    if (host && !host.isConnected) host = null;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (extractQuestion() && !isAssessment()) createWidget();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') Object.assign(options, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
  });
})();
