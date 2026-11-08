/* Shared by browser script and Node tests. */
(function (root) {
  'use strict';
  const normalize = value => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[“”"'`]/g, '').trim();
  function parseAnswer(raw) {
    let candidate = String(raw ?? '').trim();
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidate = fenced[1].trim();
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const obj = JSON.parse(candidate.slice(first, last + 1));
        let answers = obj.answers ?? obj.answer ?? obj.selected ?? [];
        if (!Array.isArray(answers)) answers = [answers];
        return { answers: answers.map(a => String(a ?? '').trim()).filter(Boolean), explanation: String(obj.explanation ?? ''), structured: true };
      } catch { /* Fall back to plain text. */ }
    }
    return { answers: candidate.split(/\n/).map(x => x.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean), explanation: '', structured: false };
  }
  function choiceIndex(value, choices) {
    const wanted = normalize(value);
    let index = choices.findIndex(c => normalize(c) === wanted);
    if (index >= 0) return index;
    const numeric = wanted.match(/^(?:option\s*)?(\d+)$/);
    if (numeric) { const n = Number(numeric[1]) - 1; if (n >= 0 && n < choices.length) return n; }
    const letter = wanted.match(/^(?:option\s*)?([a-z])(?:[.)])?$/);
    if (letter) { const n = letter[1].charCodeAt(0) - 97; if (n < choices.length) return n; }
    if (wanted.length > 3) {
      const matches = choices.map((c,i) => ({c:normalize(c),i})).filter(o => o.c.endsWith(wanted) || o.c === wanted);
      if (matches.length === 1) return matches[0].i;
    }
    return -1;
  }
  const exported = { parseAnswer, choiceIndex, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  root.PearsonAnswer = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
