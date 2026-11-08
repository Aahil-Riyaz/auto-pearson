const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ iframeReadable = true, iframeNeedsInjection = false } = {}) {
  let injected = !iframeNeedsInjection;
  let listener;
  const calls = [];
  const sessionStore=new Map();
  const url = 'https://mylab.pearson.com/Student/PlayerHomework.aspx';
  const chrome = {
    storage:{sync:{get:async () => ({model:'gemini'})},session:{get:async k=>({[k]:sessionStore.get(k)}),set:async o=>{for(const [k,v] of Object.entries(o))sessionStore.set(k,v);},remove:async k=>{sessionStore.delete(k);}}},
    tabs:{
      get:async id => ({ id,url }),
      query:async () => [],
      sendMessage:async (tabId, message, options = {}) => {
        calls.push({tabId, message, options});
        if (message.type === 'PEARSON_PROBE') {
          if (options.frameId === 0) return {ok:true,question:false,controls:0,type:'unknown',origin:'https://mylab.pearson.com'};
          if (iframeReadable && injected) return {ok:true,question:true,controls:4,type:'multiple_choice',origin:'https://exercise.pearsoncmg.com'};
          throw new Error('No receiving end');
        }
        if (message.type === 'PEARSON_START_FRAME' || message.type === 'PEARSON_STOP_FRAME') return {ok:true};
        if (message.type === 'PEARSON_PAGE_CONTROL') return {ok: options.frameId === 0};
        return {ok:true};
      },
      onRemoved:{addListener:()=>{}}
    },
    scripting:{executeScript:async () => { if (iframeReadable) injected=true; return []; }},
    webNavigation:{onCommitted:{addListener:()=>{}},getAllFrames:async () => [
      {frameId:0,url},
      {frameId:5,url:'https://exercise.pearsoncmg.com/item'},
    ]},
    runtime:{onMessage:{addListener:fn => listener = fn}}
  };
  const source = fs.readFileSync(path.join(__dirname, '../extension/background.js'),'utf8');
  vm.runInNewContext(source, {chrome, console, URL, queueMicrotask});
  const ask = (action, tabId=4) => new Promise(resolve => listener({type:'PEARSON_CONTROL',action,tabId},{},resolve));
  const fromFrame = (message, frameId=5) => new Promise(resolve => listener(message,{tab:{id:4,url},frameId,url:'https://exercise.pearsoncmg.com/item'},resolve));
  return {ask, fromFrame, calls};
}

test('start selects accessible exercise iframe rather than top-level page', async () => {
  const {ask,calls} = harness();
  const scan = await ask('scan');
  assert.equal(scan.ok,true);
  assert.equal(scan.selected.frameId,5);
  assert.equal(scan.selected.controls,4);
  const started = await ask('start');
  assert.equal(started.ok,true);
  assert.equal(started.frameId,5);
  assert.ok(calls.some(c=>c.message.type==='PEARSON_START_FRAME' && c.options.frameId===5));
  const stopped = await ask('stop');
  assert.equal(stopped.ok,true);
  assert.ok(calls.some(c=>c.message.type==='PEARSON_STOP_FRAME' && c.options.frameId===5));
});

test('diagnostic reports inaccessible frame instead of pretending to start', async () => {
  const {ask,calls} = harness({iframeReadable:false});
  const result = await ask('start');
  assert.equal(result.ok,false);
  assert.match(result.error,/Other frame origins|Custom radio|unreachable|unsupported/i);
  assert.ok(!calls.some(c=>c.message.type==='PEARSON_START_FRAME'));
});


test('question frame can request Check Answer from outer Pearson player only', async () => {
  const {fromFrame,calls} = harness();
  const result = await fromFrame({type:'PEARSON_PAGE_ACTION',action:'check'});
  assert.equal(result.ok,true);
  const action = calls.find(c=>c.message.type==='PEARSON_PAGE_CONTROL' && c.options.frameId===0);
  assert.equal(action.options.frameId,0);
  assert.equal(action.message.action,'check');
  const invalid = await fromFrame({type:'PEARSON_PAGE_ACTION',action:'delete'});
  assert.equal(invalid.ok,false);
});

test('repairs receiving-end-missing by injecting into the precise child frame', async () => {
  const {ask,calls} = harness({iframeNeedsInjection:true});
  const result=await ask('scan');
  assert.equal(result.ok,true);
  assert.equal(result.selected.frameId,5);
  const iframeProbes=calls.filter(c=>c.message.type==='PEARSON_PROBE' && c.options.frameId===5);
  assert.ok(iframeProbes.length>=2,'should ping, inject, then ping again');
});
