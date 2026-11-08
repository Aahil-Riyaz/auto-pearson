const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnswer, choiceIndex } = require('../extension/answer-utils.js');
test('parse JSON answer', () => assert.deepEqual(parseAnswer('{"answers":["B","D"],"explanation":"reason"}'), { answers: ['B', 'D'], explanation: 'reason', structured: true }));
test('parse fenced answer', () => assert.deepEqual(parseAnswer('```json\n{"answers":["42"]}\n```').answers, ['42']));
test('parse plain text fallback', () => assert.deepEqual(parseAnswer('1. ten\n2. twenty').answers, ['ten', 'twenty']));
test('match full option text', () => assert.equal(choiceIndex('Paris', ['London','Paris','Rome']), 1));
test('match option letter', () => assert.equal(choiceIndex('B', ['London','Paris','Rome']), 1));
test('match one-based option number', () => assert.equal(choiceIndex('3', ['London','Paris','Rome']), 2));
test('refuse unknown answer', () => assert.equal(choiceIndex('Tokyo', ['London','Paris','Rome']), -1));

test('reject ambiguous unstructured response', () => assert.equal(parseAnswer('Option D').structured,false));

test('Pearson regression: structured Gemini B. 90% matches option B, even with placeholder radio labels', () => {
  const parsed=parseAnswer('{"answers":["B. 90%"],"explanation":"two sided z=1.645"}');
  assert.equal(choiceIndex(parsed.answers[0], ['Option 1','Option 2','Option 3','Option 4']),1);
});
test('Pearson regression: Gemini B. 90% matches visible lettered percentages', () => {
  assert.equal(choiceIndex('B. 90%', ['A. 98%','B. 90%','C. 95%','D. 165%']),1);
  assert.equal(choiceIndex('B) 90%', ['98%', '90%', '95%', '165%']),1);
  assert.equal(choiceIndex('90%', ['A. 98%','B. 90%','C. 95%','D. 165%']),1);
});
test('reject a letter whose numeric value conflicts with the labelled choice', () => {
  assert.equal(choiceIndex('B. 90%', ['A. 98%', 'B. 95%', 'C. 90%', 'D. 165%']),-1);
});
test('reject ambiguous text-only answers and invalid option letters', () => {
  assert.equal(choiceIndex('90%', ['90%', 'B. 90%', '95%', '165%']),-1);
  assert.equal(choiceIndex('E. 90%', ['98%','90%','95%','165%']),-1);
});

test('letter with percent works when Pearson labels are noninformative generic descriptions', () => {
  assert.equal(choiceIndex('B. 90%', ['Select one answer','Select one answer','Select one answer','Select one answer']),1);
});
