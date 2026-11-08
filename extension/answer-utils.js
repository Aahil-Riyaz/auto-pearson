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
  // Pearson sometimes exposes a radio control without its visible text. Never
  // require the AI to reproduce the exact DOM label if it gives an option letter.
  const removePrefix = value => normalize(value)
    .replace(/^(?:option|choice)\s+([a-z])\s*[.):\-–—]?\s*/i, '$1. ')
    .replace(/^[a-z]\s*[.):\-–—]\s*/i, '')
    .replace(/\s+%/g, '%').trim();
  const isGeneric = label => /^(?:option|choice|answer)\s*\d+$/i.test(normalize(label));
  function choiceIndex(value, choices) {
    const wanted = normalize(value).replace(/\s+%/g, '%');
    if (!wanted || !Array.isArray(choices) || !choices.length) return -1;
    // Ambiguous value-only answers cannot resolve two visually equivalent options.
    if (!/^(?:option\s+)?[a-z]\s*[.):\-–—]/.test(wanted)) {
      const matches=choices.filter(c => removePrefix(c)===removePrefix(wanted));
      if (matches.length>1) return -1;
    }
    let index = choices.findIndex(c => normalize(c).replace(/\s+%/g,'%') === wanted);
    if (index >= 0) return index;

    const number = wanted.match(/^(?:option|choice)\s*(\d+)$/) || wanted.match(/^(\d+)$/);
    if (number) {
      const n = Number(number[1]) - 1;
      return n >= 0 && n < choices.length ? n : -1;
    }
    const letterOnly = wanted.match(/^(?:(?:option|choice|answer(?:\s+is)?)\s*[:=]?\s*)?([a-z])\s*[.)]?$/);
    if (letterOnly) {
      const n = letterOnly[1].charCodeAt(0) - 97;
      return n >= 0 && n < choices.length ? n : -1;
    }
    // B. 90%, B) 90%, Option B: 90%, Answer: B - 90%
    const withLetter = wanted.match(/^(?:(?:option|choice|answer(?:\s+is)?)\s*[:=]?\s*)?([a-z])\s*[.):\-–—]\s*(.+)$/);
    if (withLetter) {
      const n = withLetter[1].charCodeAt(0) - 97;
      if (n < 0 || n >= choices.length) return -1;
      const detail = removePrefix(withLetter[2]);
      const label = removePrefix(choices[n]);
      // A generic/placeholder label supplies no value to contradict the AI.
      if (isGeneric(choices[n]) || !label) return n;
      if (detail === label || label.endsWith(detail) || detail.endsWith(label)) return n;
      // Some Pearson labels include question-wide explanatory text. If the
      // visible option has a distinct percentage, ensure it agrees first.
      const a = detail.match(/\b(\d+(?:\.\d+)?)%/), b = label.match(/\b(\d+(?:\.\d+)?)%/);
      if (a && b) return Number(a[1]) === Number(b[1]) ? n : -1;
      if (/\d+(?:\.\d+)?%/.test(detail) && !choices.some(c => /\d+(?:\.\d+)?%/.test(removePrefix(c)))) return n;
      // When Pearson extracted labels are placeholder/long nonsensical data,
      // letter position can still be used only if none of the other labels
      // independently matches the supplied answer text.
      if (/^\[unreadable|^\[math:|^option\b/i.test(label) && !choices.some((c,i) => i!==n && removePrefix(c) === detail)) return n;
      return -1;
    }
    // Without a letter, accept only a UNIQUE exact/suffix text match.
    const matches = choices.map((c,i) => ({ text:removePrefix(c), i }))
      .filter(o => o.text && (o.text===removePrefix(wanted) || o.text.endsWith(removePrefix(wanted))));
    return matches.length===1 ? matches[0].i : -1;
  }
  const exported = { parseAnswer, choiceIndex, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  root.PearsonAnswer = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
