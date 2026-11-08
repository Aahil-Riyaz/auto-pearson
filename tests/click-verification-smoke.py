"""Offline browser test: a custom ARIA radio that ignores clicks must NOT be reported as filled."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html='''<!doctype html><html><body><main class="question"><h2>Which confidence level corresponds to z=1.645?</h2>
<div role="radio" tabindex="0" aria-checked="false">A. 98%</div>
<div role="radio" tabindex="0" aria-checked="false">B. 90%</div>
<div role="radio" tabindex="0" aria-checked="false">C. 95%</div>
<div role="radio" tabindex="0" aria-checked="false">D. 165%</div>
</main><button id="check-answer" onclick="window.submitted=true">Check Answer</button></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.evaluate('''() => {window.handlers=[];window.submitted=false;window.chrome={
      runtime:{onMessage:{addListener:f=>handlers.push(f)},sendMessage:async msg=>{
        if(msg.type==='PEARSON_REQUEST')setTimeout(()=>handlers.forEach(fn=>fn({type:'PEARSON_REPLY',requestId:msg.requestId,answer:'{"answers":["B. 90%"]}'})),50);
        return {ok:true};}},
      storage:{sync:{get:async d=>({...d,pauseBeforeSubmit:false})},onChanged:{addListener:()=>{}}}
    };}''')
    for f in ('answer-utils.js','math.js','pearson.js'):
        page.add_script_tag(content=(root/'extension'/f).read_text(encoding='utf-8'))
    started=page.evaluate('''() => new Promise(resolve=>handlers.forEach(fn=>fn({type:'PEARSON_START_FRAME'},{},r=>r&&resolve(r))))''')
    assert started['ok'],started
    page.wait_for_function("document.querySelector('#auto-pearson-widget').shadowRoot.querySelector('#status').textContent.includes('did not register the click')",timeout=6500)
    assert page.evaluate('window.submitted') is False
    assert page.locator('[role="radio"][aria-checked="true"]').count()==0
    assert not errors,errors
    print('PASS: rejected unregistered Pearson click and prevented Check Answer')
    browser.close()
