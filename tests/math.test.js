const test=require('node:test');const assert=require('node:assert/strict');
const {confidenceZAnswer,latexToText,mathML}=require('../extension/math.js');
test('recognize 90% CI critical value from rendered formula',()=>{
 const q='What is the confidence level of the following confidence interval for μ? x̄ ± 1.645 (σ/√n)';
 assert.deepEqual(confidenceZAnswer(q,['A. 98%','B. 90%','C. 95%','D. 165%']),{index:1,level:90,critical:1.645});
});
test('never mistake 165% for confidence level',()=>{
 const q='What is the confidence level of the confidence interval for μ? x̄ ± 1.645 (σ/√n)';
 assert.equal(confidenceZAnswer(q,['98%','95%','165%']),null);
});
test('no solution if missing visible math',()=>{
 assert.equal(confidenceZAnswer('What is the confidence level of the confidence interval?',['90%','95%']),null);
});
test('LaTex conversion retains critical value',()=>{
 const x=latexToText('\\bar{x} \\pm 1.645 (\\frac{\\sigma}{\\sqrt{n}})');
 assert.ok(x.includes('± 1.645'),x);
 assert.ok(x.includes('σ'),x);
});
test('MathML fraction conversion',()=>{
 const fake={localName:'mfrac',children:[{localName:'mi',textContent:'σ',children:[]},{localName:'msqrt',children:[{localName:'mi',textContent:'n',children:[]}]}]};
 assert.equal(mathML(fake),'(σ)/(√(n))');
});
