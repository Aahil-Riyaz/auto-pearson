(() => {
  'use strict';
  if (window.__autoPearsonLoaded) return;
  window.__autoPearsonLoaded = true;

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const { parseAnswer, choiceIndex, normalize } = PearsonAnswer;
  const { extractFromClone, confidenceZAnswer } = PearsonMath;
  const DEFAULTS = { model: 'gemini', pauseBeforeSubmit: true, autoAdvance: true, includeVisual: true };
  const state = { running: false, generation: 0, count: 0, errors: 0, currentRequest: null, resolveRequest: null };
  let options = { ...DEFAULTS };
  let host, statusEl, startBtn, countEl;
  let lastRevision = 0;

  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const isRadio = e => e.type === 'radio' || e.getAttribute('role') === 'radio';
  const isCheckbox = e => e.type === 'checkbox' || e.getAttribute('role') === 'checkbox';
  const hasVisibleLabel = e => {
    if (visible(e)) return true;
    const label = e.id ? [...document.querySelectorAll('label[for]')].find(l => l.htmlFor === e.id) : e.closest('label');
    return visible(label) || visible(e.parentElement) || visible(e.parentElement?.parentElement);
  };
  const textOf = e => (e?.innerText || e?.textContent || '').replace(/\s+/g, ' ').trim();
  const buttons = () => [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')].filter(visible);
  const buttonLabel = b => textOf(b) || b.value || b.getAttribute('aria-label') || b.title || '';
  const findButton = pattern => buttons().find(b => pattern.test(buttonLabel(b).trim()) && !b.disabled);
  const findCheck = () => findButton(/^(check\s*answer|final\s*check|check)$/i);
  const findNext = () => buttons().find(b => /^(continue|next|next\s*question|next\s*part|go to next question)$/i.test(buttonLabel(b).trim()) && !b.disabled); // Do not click an icon-only navigation arrow.

  // A successful Pearson submission can leave the original Check Answer button
  // in the DOM underneath a modal. That button MUST NOT block Next question.
  // Only treat a button as completion navigation when success feedback is near it
  // or inside a visible dialog, never merely because it says "Next".
  // Pearson uses several randomized positive feedback titles (for example,
  // "Well done!" and "Fantastic!"). The confirmation must still be near a
  // visible Next/Continue button or inside a visible result dialog: simply
  // finding a positive word elsewhere on the homework page is not enough.
  const SUCCESS = /\b(well done|fantastic|excellent|awesome|perfect|brilliant|good job|great job|great work|nice work|nice job|correct answer|that's correct|that is correct|you got it|congratulations)\b/i;
  const INCORRECT = /\b(incorrect|not correct|not quite|try again|wrong answer)\b/i;
  const FINISHED = /\b(homework complete|assignment complete|all questions complete|you(?:'ve| have) finished|end of assignment)\b/i;
  function completionState() {
    const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog,[class*="modal" i],[class*="dialog" i]')]
      .filter(e => visible(e) && !e.closest('#auto-pearson-widget'));
    const candidates = buttons().filter(b => /^(next\s*question|next\s*part|continue|next)$/i.test(buttonLabel(b).trim()));
    const near = button => {
      let node = button;
      for (let level = 0; node && level < 6; level++, node = node.parentElement) {
        const t = textOf(node);
        if (t.length <= 900 && SUCCESS.test(t)) return 'success';
        if (t.length <= 900 && INCORRECT.test(t)) return 'incorrect';
        if (t.length <= 900 && FINISHED.test(t)) return 'finished';
      }
      return null;
    };
    // Search actual dialogs first. They take priority over controls behind them.
    for (const dialog of dialogs) {
      const t = textOf(dialog).slice(0, 1300);
      if (INCORRECT.test(t)) return {kind:'incorrect',next:null};
      if (FINISHED.test(t)) return {kind:'finished',next:null};
      if (SUCCESS.test(t)) return {kind:'success', next:candidates.find(b => dialog.contains(b)) || null};
    }
    for (const button of candidates) {
      const kind = near(button);
      if (kind) return {kind,next:kind==='success'?button:null};
    }
    return null;
  }

  const problemControls = () => [...document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="button"]):not([type="submit"]):not([type="search"]), textarea, select, [contenteditable="true"], [role="radio"], [role="checkbox"]')]
    .filter(e => (visible(e) || ((isRadio(e) || isCheckbox(e)) && hasVisibleLabel(e))) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('header,nav,[role="navigation"],#auto-pearson-widget'));

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
    if (window !== window.top && controls.length && textOf(document.body).length >= 20 && textOf(document.body).length < 5500) return document.body;
    return null;
  }

  function describeInput(el, index) {
    // Pearson may place its label alongside a hidden radio rather than in a
    // <label>. Prefer the shortest informative enclosing option block.
    const linked = el.id ? [...document.querySelectorAll('label[for]')].find(l => l.htmlFor === el.id) : null;
    const candidates = [
      el.closest('label'), linked,
      el.closest('[role="radio"],[role="checkbox"],li,[class*="option" i],[class*="choice" i],[class*="answer" i]'),
      el.parentElement, el.nextElementSibling,
      el.parentElement?.nextElementSibling,
      el.parentElement?.parentElement
    ].filter(Boolean);
    for (const candidate of candidates) {
      const copy=candidate.cloneNode(true);
      extractFromClone(copy);
      const content=textOf(copy).replace(/\s+/g,' ').trim();
      if (content && content.length<=160 && !/^\d+$/.test(content)) return content;
    }
    return el.getAttribute('aria-label') || el.placeholder || `Option ${index + 1}`;
  }

  // Conservative visual-choice fallback. Some Pearson players draw their options
  // as clickable labels/ARIA elements and hide the underlying native input.
  // No pixel-based blind clicking: only use clear, selectable choices in a group.
  function extractVisualChoiceQuestion() {
    const candidates = [...document.querySelectorAll('label, [role="radio"], [role="checkbox"], [aria-checked], [data-testid*="option" i]')]
      .filter(e => visible(e) && !e.closest('#auto-pearson-widget, header, nav, [role="navigation"]'))
      .filter(e => /^\s*(?:[A-H][.)]\s*)?\S.{0,190}$/s.test(textOf(e)))
      .filter(e => e.matches('label,[role="radio"],[role="checkbox"]') || /choice|option|answer/i.test(e.getAttribute('data-testid') || ''));
    const options = candidates.filter(e => !candidates.some(other => other !== e && e.contains(other)));
    if (options.length < 2 || options.length > 12) return null;
    const parent = options.reduce((node, e) => {
      if (!node) return e;
      while (node && !node.contains(e)) node = node.parentElement;
      return node;
    }, null);
    let root = parent;
    for (let n = 0; root && n < 5 && textOf(root).length < 40; n++) root = root.parentElement;
    if (!root || textOf(root).length > 5000) return null;
    const labels = options.map(option => { const copy = option.cloneNode(true); extractFromClone(copy); return textOf(copy); });
    const rootCopy = root.cloneNode(true);
    const mathInfo = extractFromClone(rootCopy);
    const question = textOf(rootCopy).slice(0, 5000);
    if (!question || labels.some(l => !l)) return null;
    const type = options.some(e => e.getAttribute('role') === 'checkbox') ? 'multiple_select' : 'multiple_choice';
    const signature = normalize(question.slice(0,1200)+'|'+labels.join('|')).slice(0,1600);
    return { root, fields: options, type, question, labels, selectOptions:[], signature, mathInfo, deterministic:confidenceZAnswer(question, labels) };
  }

  function extractQuestion() {
    const controls = problemControls();
    if (!controls.length) return extractVisualChoiceQuestion();
    const root = rootFor(controls);
    if (!root) return null;
    const fields = controls.filter(c => root.contains(c));
    const radio = fields.filter(isRadio);
    const checkboxes = fields.filter(isCheckbox);
    const selects = fields.filter(c => c.tagName === 'SELECT');
    const texts = fields.filter(c => (['text', 'number', 'tel'].includes(c.type) || c.tagName === 'TEXTAREA' || c.isContentEditable));
    const type = radio.length ? 'multiple_choice' : checkboxes.length ? 'multiple_select' : selects.length ? 'matching_or_dropdown' : texts.length ? 'fill_in_the_blank' : 'unsupported';
    const activeFields = radio.length ? radio : checkboxes.length ? checkboxes : selects.length ? selects : texts;
    const clone = root.cloneNode(true);
    clone.querySelectorAll('button, nav, script, style, [role="navigation"], input, textarea, select, [contenteditable="true"]').forEach(e => e.remove());
    const mathInfo = extractFromClone(clone);
    const question = textOf(clone).slice(0, 6000);
    const fieldLabels = activeFields.map(describeInput);
    const selectOptions = selects.map(select => [...select.options].filter(o => o.value && !/^(select|choose)/i.test(o.textContent.trim())).map(o => o.textContent.trim()));
    const signature = normalize(question.slice(0, 1200) + '|' + fieldLabels.join('|')).slice(0, 1600);
    if (!question || !signature || !activeFields.length) return null;
    return { root, fields: activeFields, type, question, labels: fieldLabels, selectOptions, signature, mathInfo, deterministic:confidenceZAnswer(question, fieldLabels) }; 
  }

  function promptFor(q) {
    const payload = {
      type: q.type,
      question: q.question,
      options: ['multiple_choice', 'multiple_select'].includes(q.type) ? q.labels.map((label, i) => `${String.fromCharCode(65+i)}. ${label}`) : [],
      dropdownOptions: q.selectOptions,
      fieldCount: q.fields.length,
      detectedMath: q.mathInfo?.formulas || 0,
      mathUnrecognized: q.mathInfo?.unreadable || 0
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

  function fieldSelected(el) {
    if (el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox')
      return el.getAttribute('aria-checked') === 'true';
    return Boolean(el.checked);
  }
  async function selectField(el, checked) {
    if (fieldSelected(el) === checked) return true;
    const label=el.closest('label') || (el.id && [...document.querySelectorAll('label[for]')].find(l=>l.htmlFor===el.id));
    const targets=[visible(el)?el:null, visible(label)?label:null, visible(el.parentElement)?el.parentElement:null]
      .filter((target,i,all)=>target && all.indexOf(target)===i);
    // Native clicks first; some Pearson radio controls place the listener on
    // their visible label. Never submit if we cannot verify the new state.
    for (const target of targets) {
      try { target.click(); } catch {}
      await delay(160);
      if (fieldSelected(el)===checked) return true;
    }
    return false;
  }

  async function apply(q, answers) {
    if (!answers.length) return { ok: false, reason: 'No reliable AI answer was returned.' };
    if (q.type === 'multiple_choice') {
      const index = choiceIndex(answers[0], q.labels);
      if (index < 0) return { ok: false, reason: `Couldn't match "${answers[0]}" to a choice. Pearson labels: ${q.labels.slice(0,8).join(' | ').slice(0,180)}` };
      const selected = await selectField(q.fields[index], true);
      if (!selected) return { ok:false, reason:`Matched option ${String.fromCharCode(65+index)} but Pearson did not register the click. Stopped before Check Answer.` };
      // Some custom widgets take a moment before updating other controls.
      await delay(120);
      if (!fieldSelected(q.fields[index])) return {ok:false, reason:'Pearson reverted the selected option. Stopped without submitting.'};
      return { ok: true };
    }
    if (q.type === 'multiple_select') {
      const indexes = answers.map(a => choiceIndex(a, q.labels));
      if (indexes.some(i => i < 0)) return { ok: false, reason: 'Could not match every checkbox answer.' };
      for (let i=0;i<q.fields.length;i++) {
        if (!await selectField(q.fields[i],indexes.includes(i))) return {ok:false,reason:`Pearson did not accept checkbox ${i+1}.`};
      }
      return { ok: true };
    }
    if (q.type === 'fill_in_the_blank') {
      if (answers.length !== q.fields.length) return { ok: false, reason: `Expected ${q.fields.length} blanks but received ${answers.length}.` };
      for (let i=0;i<q.fields.length;i++) {
        setField(q.fields[i],answers[i]);
        await delay(60);
        if (q.fields[i].value!==undefined && String(q.fields[i].value).trim()!==String(answers[i]).trim())
          return {ok:false,reason:`Pearson did not retain text in blank ${i+1}.`};
      }
      return {ok:true};
    }
    if (q.type === 'matching_or_dropdown') {
      if (answers.length !== q.fields.length) return { ok: false, reason: 'Dropdown answer count mismatch.' };
      for (let i = 0; i < q.fields.length; i++) {
        const el = q.fields[i];
        const desired = normalize(answers[i]);
        const opt = [...el.options].find(o => normalize(o.textContent) === desired) || el.options[choiceIndex(answers[i], [...el.options].map(o => o.textContent))];
        if (!opt) return { ok: false, reason: `No option matches dropdown answer ${i + 1}.` };
        setField(el, opt.value);
        if (el.value !== opt.value) return {ok:false,reason:`Pearson did not accept dropdown ${i+1}.`};
      }
      return { ok: true };
    }
    return { ok: false, reason: 'Unsupported question widget (for example drag-and-drop or a math editor).' };
  }

  function updateUI(message) {
    if (statusEl) statusEl.textContent = message;
    if (countEl) countEl.textContent = `${state.count} filled`;
    if (startBtn) startBtn.textContent = state.running ? 'Stop' : 'Start';
    if (state.running) chrome.runtime.sendMessage({type:'PEARSON_PROGRESS', status:message, isRunning:true, count:state.count}).catch(()=>{});
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
    chrome.runtime.sendMessage({type:'PEARSON_PROGRESS',status:message,isRunning:false,count:state.count}).catch(()=>{});
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

  // Two different questions (or subparts) can legitimately have the same
  // wording and option labels. A transition is also proven by new, unanswered
  // controls replacing the answered controls after Next was clicked.
  function isFreshQuestion(previous, current) {
    if (!current) return false;
    if (current.signature !== previous.signature) return true;
    const controlsReplaced = current.fields.length && current.fields[0] !== previous.fields[0];
    const oldGone = !previous.root?.isConnected || previous.fields.some(f => !f.isConnected);
    const previousHadAnswer = previous.fields.some(f => (isRadio(f)||isCheckbox(f)) ? fieldSelected(f) : String(f.value||'').trim() !== '');
    const nowUnanswered = current.fields.every(f => (isRadio(f)||isCheckbox(f)) ? !fieldSelected(f) : String(f.value||'').trim() === '');
    return Boolean((controlsReplaced || oldGone || previousHadAnswer) && nowUnanswered);
  }

  async function waitForNewQuestion(previous, generation) {
    // The old question remains visible *behind* the feedback dialog until
    // Pearson finishes navigation. Do not screenshot or answer it again.
    await delay(650);
    const deadline=Date.now()+45000;
    while (stillRunning(generation) && Date.now()<deadline) {
      const modal=completionState();
      if (modal?.kind === 'finished') { stop('Homework appears complete.'); return false; }
      if (!modal) {
        const next=extractQuestion();
        if (isFreshQuestion(previous,next)) return true;
      }
      await delay(300);
    }
    if (stillRunning(generation)) stop('Clicked Next, but Pearson did not load a new question or part. Continue manually.');
    return false;
  }

  async function getRemoteProgress(action) {
    try { return await chrome.runtime.sendMessage({type:'PEARSON_PAGE_ACTION',action}); }
    catch { return null; }
  }

  // Used after Check Answer AND while waiting for a user to submit manually.
  // We never ask the AI about a visible "Well done!" or feedback overlay.
  async function afterSubmission(previous, generation, { manualReview = false } = {}) {
    let lastRemote=0;
    let lastNotice='';
    const deadline=manualReview ? Infinity : Date.now()+35000;
    while (stillRunning(generation) && Date.now()<deadline) {
      const current=extractQuestion();
      const modal=completionState();
      // Pearson can reveal the next question underneath a still-open feedback
      // overlay; don't start a screenshot while the modal remains on screen.
      if (!modal && current && current.signature!==previous.signature) return true;
      const feedback=feedbackText();
      if (modal?.kind==='incorrect' || INCORRECT.test(feedback)) {
        stop('Pearson marked this answer incorrect. Stopped without retrying.'); return false;
      }
      if (modal?.kind==='finished') { stop('Homework appears complete.'); return false; }
      if (modal?.kind==='success' && !options.autoAdvance && lastNotice!=='manual-next') {
        updateUI('Correct! Click Next question/Continue when ready.');lastNotice='manual-next';
      }
      if (options.autoAdvance && modal?.kind==='success' && modal.next) {
        updateUI('Correct. Clicking Next question / next part…');
        modal.next.click();
        return waitForNewQuestion(previous,generation);
      }
      // The result dialog can be in an *outer* Pearson frame, while this script
      // runs inside the exercise frame. Ask the background controller to inspect
      // other permitted Pearson frames. It never touches login/session frames.
      if (Date.now()-lastRemote>850) {
        lastRemote=Date.now();
        const remote=await getRemoteProgress('status');
        if (remote?.incorrect) {stop('Pearson marked the answer incorrect.');return false;}
        if (remote?.finished) {stop('Homework appears complete.');return false;}
        if (remote?.completed && !options.autoAdvance && lastNotice!=='manual-next') {
          updateUI('Correct! Click Next question/Continue when ready.');lastNotice='manual-next';
        }
        if (options.autoAdvance && remote?.completed) {
          const clicked=await getRemoteProgress('next');
          if (clicked?.ok && clicked?.clicked) {
            updateUI('Correct. Opening the next question / subpart…');
            return waitForNewQuestion(previous,generation);
          }
        }
      }
      // If user manually advanced without a different signature, detect a
      // freshly cleared answer field only after a previous selection existed.
      if (!modal && isFreshQuestion(previous,current)) return true;
      await delay(350);
    }
    if (stillRunning(generation)) stop('Pearson did not show a confirmed result or next question. Continue manually.');
    return false;
  }

  async function handleSubmission(q, generation) {
    const check = findCheck();
    if (check) check.click();
    else {
      const remote = await getRemoteProgress('check');
      if (!remote?.ok) {
        updateUI('Answer filled. Check Answer was not found; submit manually.');
        return afterSubmission(q,generation,{manualReview:true});
      }
    }
    updateUI('Checking answer…');
    return afterSubmission(q,generation);
  }

  async function loop(generation) {
    let last = '';
    while (stillRunning(generation)) {
      const q = await waitFor(extractQuestion, generation, 12000);
      if (!stillRunning(generation)) return;
      if (!q) { stop('Could not identify a supported question or subpart.'); return; }
      // A resumed run may begin while a previous correct-answer dialog remains
      // open. Resolve it before reading/screenshotting the question behind it.
      const local=completionState();
      const remote=local ? null : await getRemoteProgress('status');
      if (local?.kind==='finished' || remote?.finished) {stop('Homework appears complete.');return;}
      if (local?.kind==='incorrect' || remote?.incorrect) {stop('Pearson is showing incorrect feedback. Review manually.');return;}
      if (local?.kind==='success' || remote?.completed) {
        updateUI('Correct-answer dialog detected; advancing before taking another screenshot…');
        const advanced=await afterSubmission(q,generation,{manualReview:true});
        if (!advanced) return;
        last='';continue;
      }
      if (last === q.signature) {
        updateUI('Waiting for the next question or subpart…');
        const advanced=await afterSubmission(q,generation,{manualReview:true});
        if (!advanced) return;
        last='';continue;
      }
      last=q.signature;
      updateUI('Preparing visual AI request…');
      const reply=await askAI(promptFor(q),generation);
      if (!stillRunning(generation)) return;
      if (reply.error) {stop(reply.error);return;}
      const answer=parseAnswer(reply.answer);
      if (!answer.structured || !answer.answers.length) {
        stop('AI response was not valid structured JSON with a usable answer. No option was selected.');return;
      }
      const current=extractQuestion();
      if (!current || current.signature!==q.signature || completionState()?.kind==='success') {
        updateUI('Question changed while AI was answering; retrying the current question.');
        last='';continue;
      }
      if (current.type==='multiple_choice' && /confidence\s+level|probability/i.test(current.question)) {
        const picked=choiceIndex(answer.answers[0],current.labels);
        const candidate=current.labels[picked]||'';
        const percent=candidate.match(/\b(\d+(?:\.\d+)?)\s*%/);
        if (percent && Number(percent[1])>100) {
          stop(`Rejected impossible probability/confidence answer: ${candidate}. Please review manually.`);return;
        }
      }
      if (current.deterministic && current.type==='multiple_choice') {
        const returnedIndex=choiceIndex(answer.answers[0],current.labels);
        if (returnedIndex>=0 && returnedIndex!==current.deterministic.index) {
          stop(`AI selected ${current.labels[returnedIndex]}, but a verified critical-value rule gives ${current.labels[current.deterministic.index]}. Stopped for review.`);return;
        }
      }
      const outcome=await apply(current,answer.answers);
      if (!outcome.ok) {
        stop(`Manual action needed: ${outcome.reason} AI response: ${answer.answers.join(' | ').slice(0,250)}`);return;
      }
      state.count++;
      updateUI('Answer filled. '+(options.pauseBeforeSubmit?'Review it and click Check Answer yourself.':'Submitting…'));
      const advanced=options.pauseBeforeSubmit
        ? await afterSubmission(current,generation,{manualReview:true})
        : await handleSubmission(current,generation);
      if (!advanced) return;
      last=''; // The next subpart can have identical wording and options.
    }
  }

  async function start({ fromController = false } = {}) {
    if (state.running) return {ok:false,error:'Already running'};
    if (isAssessment()) { updateUI('Auto mode is disabled on quizzes and exams.'); return {ok:false,error:'Quizzes/exams are not supported.'}; }
    const q = extractQuestion();
    if (!q) { updateUI(diagnostic()); return {ok:false,error:diagnostic()}; }
    options = { ...DEFAULTS, ...await chrome.storage.sync.get(DEFAULTS) };
    if (!fromController && !confirm(`Start Auto-Pearson using ${options.model}? Question text will be sent to that AI tab. AI answers may be wrong. ${options.pauseBeforeSubmit ? 'You will review and submit each answer.' : 'Check Answer will be clicked automatically.'}`)) return {ok:false,error:'Start cancelled'};
    state.running = true;
    state.generation++;
    const generation = state.generation;
    updateUI('Starting…');
    loop(generation).catch(error => { console.error(error); stop(`Unexpected error: ${error.message}`); });
    return {ok:true};
  }

  function diagnostic() {
    const controls = problemControls();
    if (!controls.length) return 'Toolbar loaded, but no standard answer controls were detected. This Pearson player may use an iframe or custom math/radio widgets.';
    if (!extractQuestion()) return `Toolbar loaded; ${controls.length} possible answer control(s) found, but the question container was not identified. Automatic answering is unavailable on this page.`;
    return 'Ready. Review AI answers before checking.';
  }

  function createWidget() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'auto-pearson-widget';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      *{box-sizing:border-box} .card{width:290px;background:#132036;color:#edf3ff;border:1px solid #334866;border-radius:15px;padding:14px;box-shadow:0 9px 30px #0005;font:13px/1.45 system-ui,Arial,sans-serif}
      .top{display:flex;justify-content:space-between;align-items:center;gap:8px}.name{font-weight:750;font-size:15px}.sub{font-size:11px;color:#a8b7d5}
      .buttons{display:flex;gap:7px;margin:10px 0}.buttons button{cursor:pointer;border:0;border-radius:8px;font-weight:700;padding:7px 10px}.start{background:#7dc7ff;color:#0b1930;flex:1}.settings{background:#30425d;color:white}
      .status{font-size:12px;color:#d8e8fb;min-height:32px;overflow-wrap:anywhere}.tiny{margin-top:8px;color:#a8b7d5;font-size:11px}
      </style><section class="card" role="region" aria-label="Auto Pearson controls"><div class="top"><div><div class="name">Auto-Pearson</div><div class="sub">Experimental MyLab helper</div></div><div class="sub" id="count">0 filled</div></div><div class="buttons"><button class="start" id="start">Start</button><button class="settings" id="settings">Settings</button></div><div class="status" id="status">Ready when your homework question is open.</div><div class="tiny">Use Stop any time. Review AI answers carefully.</div></section>`;
    (document.body || document.documentElement).appendChild(host);
    statusEl = shadow.getElementById('status');
    statusEl.textContent = diagnostic();
    startBtn = shadow.getElementById('start');
    countEl = shadow.getElementById('count');
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      const action = state.running ? 'stop' : 'start';
      try {
        const r = await chrome.runtime.sendMessage({type:'PEARSON_CONTROL',action});
        updateUI(r?.error || r?.message || (r?.ok ? 'Started.' : 'Could not start.'));
      } catch (error) { updateUI(error.message); }
      finally { startBtn.disabled = false; }
    });
    shadow.getElementById('settings').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'PEARSON_OPEN_SETTINGS' }));
  }

  async function preserveScreenshot(src) {
    if (window !== window.top || typeof src !== 'string' || !src.startsWith('data:image/png;base64,'))
      throw new Error('Expected a visible Pearson-page screenshot.');
    // Do not crop or resize: the full-resolution formula, options, charts, and
    // scroll position must remain exactly as shown on screen.
    return {image:src,rect:{mode:'full-viewport'}};
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'PEARSON_CROP_IMAGE' && window === window.top) { preserveScreenshot(msg.shot).then(v=>respond({ok:true,...v})).catch(e=>respond({ok:false,error:e.message}));return true; }
    if (msg.type === 'PEARSON_CAPTURE_VISIBILITY' && window === window.top) { if (host) host.style.visibility=msg.hidden?'hidden':'visible';respond({ok:true});return; }
    if (msg.type === 'PEARSON_PAGE_CONTROL') {
      // Buttons may live in the Pearson question iframe or the parent frame.
      const check=findCheck();const next=findNext();const completion=completionState();
      if (msg.action === 'status') {
        respond({ok:true,check:!!check,next:!!next,completed:completion?.kind==='success',
          incorrect:completion?.kind==='incorrect',finished:completion?.kind==='finished',
          readyNext:!!(next && !check)});return;
      }
      if (msg.action === 'check') {
        if (!check || completion) {respond({ok:false,error:'No actionable Check Answer button.'});return;}
        check.click();respond({ok:true,clicked:true});return;
      }
      if (msg.action === 'next') {
        // A success dialog may cover an older, still-enabled Check Answer.
        // Never treat an ordinary navigation button in an outer frame as a
        // completed problem; require visible successful feedback nearby.
        const target=completion?.kind==='success' ? completion.next : null;
        if (!target) {respond({ok:false,error:'No confirmed post-answer Next/Continue button.'});return;}
        target.click();respond({ok:true,clicked:true});return;
      }
    }
    if (msg.type === 'PEARSON_PROBE') {
      const q = isAssessment() ? null : extractQuestion();
      respond({ ok: true, question:Boolean(q), type:q?.type || 'unknown', controls:q?.fields?.length || problemControls().length, origin:location.origin, math:q?.mathInfo||{formulas:0,unreadable:0}, excerpt:q?.question?.slice(0,900)||'', deterministic:q?.deterministic?.level || null });
      return;
    }
    if (msg.type === 'PEARSON_START_FRAME') {
      start({fromController:true}).then(respond).catch(e => respond({ok:false,error:e.message}));
      return true;
    }
    if (msg.type === 'PEARSON_STOP_FRAME') { if (state.running) stop(); respond({ok:true}); return; }
    if (msg.type === 'PEARSON_NOTIFY' && window === window.top) {
      if (msg.revision && msg.revision < lastRevision) {respond({ok:true,stale:true});return;}
      lastRevision=msg.revision || lastRevision;
      if (countEl) countEl.textContent=`${Number(msg.count)||0} filled`;
      if (statusEl) statusEl.textContent = msg.status || 'Ready.';
      if (startBtn) startBtn.textContent = msg.isRunning ? 'Stop' : 'Start';
      state.running = Boolean(msg.isRunning);
      respond({ok:true});
    }
  });

  // Always show Start on the *top-level* Pearson homework player, even if answer
  // fields are custom or still loading. Never silently hide the controls.
  // Frames containing a recognizable question can also offer their own toolbar.
  const isHomeworkPlayer = () => /(?:playerhomework|homework)/i.test(location.pathname) && window === window.top;
  const shouldShow = () => !isAssessment() && window === window.top && (isHomeworkPlayer() || !!extractQuestion());
  const observer = new MutationObserver(() => {
    if (host && !host.isConnected) host = null;
    if (!host && shouldShow()) createWidget();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (shouldShow()) createWidget();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') Object.assign(options, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
  });
})();
