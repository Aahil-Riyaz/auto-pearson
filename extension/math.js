/* Visible math extraction and deterministic critical-value guard. No remote requests. */
(function (root) {
  'use strict';
  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  function mathML(node) {
    if (!node) return '';
    const name = (node.localName || '').toLowerCase();
    const kids = [...node.children].filter(n => (n.localName || '').toLowerCase() !== 'annotation');
    const parts = () => kids.map(mathML).join('');
    if (name === 'mfrac') return `(${mathML(kids[0])})/(${mathML(kids[1])})`;
    if (name === 'msqrt') return `√(${parts()})`;
    if (name === 'mroot') return `root(${mathML(kids[0])},${mathML(kids[1])})`;
    if (name === 'msup') return `${mathML(kids[0])}^(${mathML(kids[1])})`;
    if (name === 'msub') return `${mathML(kids[0])}_(${mathML(kids[1])})`;
    if (name === 'msubsup') return `${mathML(kids[0])}_(${mathML(kids[1])})^(${mathML(kids[2])})`;
    if (name === 'mover') return `${mathML(kids[0])} over ${mathML(kids[1])}`;
    if (name === 'munder') return `${mathML(kids[0])} under ${mathML(kids[1])}`;
    if (name === 'mi' || name === 'mn' || name === 'mo' || name === 'mtext') return node.textContent || '';
    return kids.length ? parts() : (node.textContent || '');
  }
  function latexToText(raw) {
    let s = norm(raw);
    s = s.replace(/\\(?:left|right)\b/g, '');
    s = s.replace(/\\(?:pm|plusminus)\b/g, '±').replace(/\\sigma\b/g, 'σ').replace(/\\mu\b/g, 'μ')
      .replace(/\\bar\{([^}]+)\}/g, '$1̄').replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
    return s;
  }
  function formulaText(el) {
    const ann = el.querySelector?.('annotation[encoding*="tex" i]');
    if (ann?.textContent?.trim()) return latexToText(ann.textContent);
    for (const attr of ['data-latex', 'data-tex', 'alttext', 'aria-label', 'alt', 'title']) {
      const x = el.getAttribute?.(attr);
      if (x?.trim() && !/^image\s*$/i.test(x.trim())) return latexToText(x);
    }
    const math = el.localName === 'math' ? el : el.querySelector?.('math');
    if (math) return norm(mathML(math));
    return '';
  }
  function extractFromClone(clone) {
    let unreadable = 0;
    let formulas = 0;
    // A top-level notation element owns its children, so never append the same formula twice.
    const selector = 'math, .katex, .MathJax, mjx-container, img, svg, canvas, [data-latex], [data-tex]';
    const nodes = [...clone.querySelectorAll(selector)].filter(el => !el.parentElement?.closest(selector));
    for (const node of nodes) {
      const label = formulaText(node);
      formulas++;
      if (!label) unreadable++;
      node.replaceWith(clone.ownerDocument.createTextNode(label ? ` [MATH: ${label}] ` : ' [UNREADABLE FORMULA OR IMAGE] '));
    }
    return { formulas, unreadable };
  }
  function confidenceZAnswer(question, choices) {
    const q = String(question || '').replace(/\\pm/g, '±').replace(/\\sigma/g,'σ');
    if (!/confidence\s+level/i.test(q) || !/confidence\s+interval/i.test(q)) return null;
    if (!/(?:±|\+\s*\/\s*-|plus\s+or\s+minus)/i.test(q)) return null;
    // Common exact two-sided normal critical values; requires visible sigma or z notation.
    if (!/(?:σ|sigma|z\s*\*|z[_\s-]*critical)/i.test(q)) return null;
    const criticals = [
      {value:1.282,level:80},{value:1.645,level:90},{value:1.960,level:95},
      {value:2.326,level:98},{value:2.576,level:99}
    ];
    const values = [...q.matchAll(/\b(1\.282|1\.645|1\.96(?:0)?|2\.326|2\.576)\b/g)].map(m => Number(m[1]));
    if (values.length !== 1) return null;
    const match = criticals.find(c => Math.abs(values[0] - c.value) < .0006);
    if (!match) return null;
    const indexes = choices.map((choice,i) => ({i,txt:String(choice)})).filter(o => {
      const p = o.txt.match(/\b(\d+(?:\.\d+)?)\s*%/);
      return p && Number(p[1]) === match.level;
    });
    return indexes.length === 1 ? {index:indexes[0].i,level:match.level,critical:match.value} : null;
  }
  const exported = { mathML, latexToText, formulaText, extractFromClone, confidenceZAnswer };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  root.PearsonMath = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
