const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'); const vm=require('node:vm');const path=require('node:path');
function fixture(){
 const seen=[],store=new Map(), handlers=[];
 const parentUrl='https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=demo';
 const chrome={
  runtime:{onMessage:{addListener:f=>handlers.push(f)},getURL:s=>'chrome-extension://test/'+s},
  tabs:{
   get:async id=>({id,url:parentUrl,windowId:99}),
   query:async opts=>opts.url?[{id:2,url:'https://gemini.google.com/app',windowId:99}]:[{id:1,url:parentUrl,windowId:99}],
   sendMessage:async(id,msg,options)=>{
    seen.push(['send',id,msg.type,options?.frameId,msg]);
    if(msg.type==='PEARSON_PROBE')return {ok:true,question:options?.frameId===5,controls:options?.frameId===5?4:0,type:'multiple_choice'};
    if(msg.type==='PEARSON_AI_PING')return {ok:true,model:'gemini'};
    if(msg.type==='PEARSON_CROP_IMAGE')throw new Error('Legacy crop must not be used');
    return {ok:true};
   },
   captureVisibleTab:async()=>{seen.push(['capture']);return 'data:image/png;base64,'+'A'.repeat(4000);},
   update:async(id,opt)=>{seen.push(['activate',id]);},
   onRemoved:{addListener:()=>{}}
  },
  scripting:{executeScript:async()=>[]},
  storage:{sync:{get:async defaults=>({model:'gemini',includeVisual:true})},session:{get:async keys=>{
   const obj={}; for(const k of (Array.isArray(keys)?keys:[keys]))obj[k]=store.get(k);return obj;
  },set:async o=>{for(const[k,v]of Object.entries(o))store.set(k,v);},remove:async k=>{store.delete(k);}}},
  webNavigation:{getAllFrames:async()=>[{frameId:0,url:parentUrl},{frameId:5,url:'https://tdx.acs.pearson.com/question'}],onCommitted:{addListener:()=>{}}},
  windows:{create:async()=>{}},
 };
 const context={chrome,URL,Promise,Map,Set,console,setTimeout,clearTimeout,queueMicrotask};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
 async function msg(message,sender={}){
  return new Promise(resolve=>{for(const fn of handlers){const r=fn(message,sender,resolve); if(r!==undefined)break;}});
 }
 return {msg,seen,store,parentUrl};
}
const sleep=n=>new Promise(r=>setTimeout(r,n));
test('visual request captures Pearson, sends screenshot to Gemini, and returns to original frame',async()=>{
 const h=fixture();const started=await h.msg({type:'PEARSON_CONTROL',action:'start',tabId:1});assert.equal(started.ok,true);
 const question='{ "type":"multiple_choice", "question":"confidence 1.645", "options":["A. 98%","B. 90%"] }';
 const accepted=await h.msg({type:'PEARSON_REQUEST',question,requestId:'r1'},{tab:{id:1,url:h.parentUrl},url:'https://tdx.acs.pearson.com/question',frameId:5});assert.equal(accepted.ok,true);
 for(let i=0;i<25&&!h.seen.some(x=>x[2]==='PEARSON_ASK');i++)await sleep(75);
 const ask=h.seen.find(x=>x[2]==='PEARSON_ASK');assert.ok(ask,JSON.stringify(h.seen)); assert.equal(ask[1],2); assert.ok(ask[4].screenshot.startsWith('data:image/png;base64,'));
 assert.equal(ask[4].question,question);
 assert.equal(h.seen.filter(x=>x[0]==='capture').length,1);
 const ai=await h.msg({type:'PEARSON_AI_RESULT',requestId:'r1',answer:'{"answers":["B"]}'},{tab:{id:2,url:'https://gemini.google.com/app'}});assert.equal(ai.ok,true);
 for(let i=0;i<25&&!h.seen.some(x=>x[2]==='PEARSON_REPLY');i++)await sleep(75);
 const reply=h.seen.find(x=>x[2]==='PEARSON_REPLY');assert.ok(reply);assert.equal(reply[1],1);assert.equal(reply[3],5);assert.match(reply[4].answer,/"B"/);
 assert.ok(h.seen.some(x=>x[0]==='activate'&&x[1]===2));assert.ok(h.seen.some(x=>x[0]==='activate'&&x[1]===1));
});
