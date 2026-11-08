"""Playwright mock of Pearson's 'Fantastic! -> Next question' UI without dialog semantics.

Exercise three answer steps: a normal question, then two identically-worded
subparts. The old Check Answer button stays behind the success modal.
No real Pearson account or Gemini traffic is used.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = '''<!doctype html><html><head><style>
.question {margin:28px 35px;} .choice {display:block;padding:5px;}
#check {position:absolute;bottom:30px;right:30px;}
.modal-backdrop {position:fixed;inset:0;background:#ffffffbb;display:grid;place-items:center;z-index:99;}
.modal {width:230px;padding:25px;background:#fff;border:2px solid #189cdd;border-radius:8px;}
</style></head><body>
<main class="question" id="qmain"></main>
<button id="check">Check Answer</button>
</body></html>'''

setup = '''() => {
window.errors=[];window.requests=[];window.clicks=0;window.currentStep=0;
window.handler=[];
window.chrome={
 runtime: {
  onMessage: {addListener: f => window.handler.push(f)},
  sendMessage: async m => {
   if(m.type==='PEARSON_REQUEST'){
     window.requests.push({step:currentStep,question:m.question,dialog:!!document.querySelector('.modal-backdrop')});
     const answer=currentStep===0?'B. 90%':'A. 2';
     setTimeout(()=>window.handler.forEach(f=>f({type:'PEARSON_REPLY',requestId:m.requestId,answer:JSON.stringify({answers:[answer]})},{},()=>{})),80);
     return {ok:true};
   }
   if(m.type==='PEARSON_PAGE_ACTION'){
     return await new Promise(resolve => {
       const answers=[];
       for(const f of window.handler){
         f({type:'PEARSON_PAGE_CONTROL',action:m.action},{},r=>{if(r)answers.push(r)});
       }
       const chosen=answers.find(r=>r?.completed || r?.finished || r?.incorrect || r?.clicked);
       resolve(chosen || {ok:true});
     });
   }
   return {ok:true};
  }
 },
 storage:{sync:{get: async defaults=>({...defaults,pauseBeforeSubmit:false,autoAdvance:true})},onChanged:{addListener:()=>{}}}
};
function build(index) {
 const main=document.querySelector('#qmain');
 main.innerHTML=index===0?`<h2>What confidence level corresponds to z = 1.645?</h2>
  <label class="choice"><input type="radio" name="answer" value="98%"> A. 98%</label>
  <label class="choice"><input type="radio" name="answer" value="90%"> B. 90%</label>
  <label class="choice"><input type="radio" name="answer" value="95%"> C. 95%</label>`
  : `<h2>Part: Choose the value two.</h2>
  <label class="choice"><input type="radio" name="answer" value="2"> A. 2</label>
  <label class="choice"><input type="radio" name="answer" value="3"> B. 3</label>`;
}
document.querySelector('#check').onclick=()=>{
 const selected=document.querySelector('input[name="answer"]:checked');
 if(!selected)throw new Error('Checked without selected answer');
 if(currentStep===0 && selected.value!=='90%')throw new Error('Expected B 90%');
 if(currentStep>0 && selected.value!=='2')throw new Error('Expected A 2');
 const backdrop=document.createElement('div');backdrop.className='modal-backdrop';
 if(currentStep===2){
   backdrop.innerHTML='<div class="modal" role="dialog"><h2>Homework complete!</h2></div>';
 }else{
   backdrop.innerHTML='<div class="result-card"><h2>Fantastic!</h2><button id="modalNext">Next question</button></div>';
   backdrop.querySelector('#modalNext').onclick=()=>{
     window.clicks++;
     backdrop.remove();
     window.currentStep++;
     // Changing to next question/part does not reload the iframe, but Pearson
     // replaces the input controls asynchronously.
     setTimeout(()=>build(currentStep),100);
   };
 }
 document.body.appendChild(backdrop);
};
build(0);
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content(html)
    page.on('pageerror', lambda e: page.evaluate('window.errors.push(arguments[0])', str(e)))
    page.evaluate(setup)
    for filename in ('answer-utils.js','math.js','pearson.js'):
        page.add_script_tag(content=(root/'extension'/filename).read_text())
    page.evaluate('''() => {for(const f of window.handler) f({type:'PEARSON_START_FRAME'},{},()=>{});}''')
    page.wait_for_function('window.currentStep===2 && window.requests.length>=3',timeout=35000)
    page.wait_for_function('''() => document.querySelector('#auto-pearson-widget').shadowRoot.querySelector('#status').textContent.includes('complete')''', timeout=10000)
    records=page.evaluate('window.requests')
    assert [r['step'] for r in records]==list(range(3)),records
    assert all(not r['dialog'] for r in records),records
    assert page.evaluate('window.clicks')==2
    assert not page.evaluate('window.errors')
    print('PASS: Fantastic success overlay without dialog role advances; Check Answer behind overlay does not block Next; no feedback AI requests')
    browser.close()
