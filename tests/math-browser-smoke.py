"""Mock frame renders actual MathML, then runs the real content script (no platform login)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).parents[1]
html='''<!doctype html><html><body><section class="question"><p>What is the confidence level of the following confidence interval for μ?</p>
<div><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x̄</mi><mo>±</mo><mn>1.645</mn><mo>(</mo><mfrac><mi>σ</mi><msqrt><mi>n</mi></msqrt></mfrac><mo>)</mo></math></div>
<label><input type="radio" name="answer" value="A">A. 98%</label>
<label><input type="radio" name="answer" value="B">B. 90%</label>
<label><input type="radio" name="answer" value="C">C. 95%</label>
<label><input type="radio" name="answer" value="D">D. 165%</label></section></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(); errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(html)
    page.evaluate('''() => { window.handlers=[];window.chrome={
        runtime:{onMessage:{addListener:fn=>window.handlers.push(fn)},sendMessage:async msg=>{if(msg.type==='PEARSON_REQUEST')setTimeout(()=>window.handlers.forEach(fn=>fn({type:'PEARSON_REPLY',requestId:msg.requestId,answer:'{"answers":["B"],"explanation":"90%"}'})),100);return {ok:true};}},
        storage:{sync:{get:async d=>d},onChanged:{addListener:()=>{}}}
    };}''')
    for f in ('answer-utils.js','math.js','pearson.js'):
        page.add_script_tag(content=(root/'extension'/f).read_text())
    diagnosis=page.evaluate('''async () => {
      return new Promise(resolve=>window.handlers.forEach(fn=>fn({type:'PEARSON_PROBE'},{},r=>r?.ok&&resolve(r))));
    }''')
    print('DIAGNOSIS', diagnosis)
    assert diagnosis['question'] is True
    assert diagnosis['deterministic']==90, diagnosis
    assert '1.645' in diagnosis['excerpt'],diagnosis
    assert 'σ' in diagnosis['excerpt'],diagnosis
    page.evaluate('''async () => {
      return new Promise(resolve=>window.handlers.forEach(fn=>fn({type:'PEARSON_START_FRAME'},{},r=>r?.ok&&resolve(r))));
    }''')
    page.wait_for_function("document.querySelector('input[value=B]').checked",timeout=7000)
    assert not page.locator('input[value=D]').is_checked()
    assert not errors,errors
    print('PASS: content script reads rendered math, applies mocked Gemini 90% JSON answer, and leaves submission for review')
    browser.close()
