"""Full Chrome MV3 extension E2E against intercepted FAKE Pearson and Gemini pages.
Not a real authenticated site test; uses temporary test-only screenshot permission.
"""
import json, shutil, tempfile, time
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
outer='''<!doctype html><html><body style="margin:0;font:16px Arial;background:white"><header style="height:95px;padding:12px">Pearson MyLab Mock</header><nav style="background:#0086a1;color:white;padding:12px">Homework: Homework 4</nav><div style="display:flex"><aside style="width:230px">Question list</aside><iframe src="https://tdx.acs.pearson.com/exercises/question1" style="border:0;width:calc(100vw - 240px);height:660px"></iframe></div><button id="check" style="position:fixed;bottom:10px;right:10px">Check answer</button><script>document.getElementById('check').onclick=()=>{document.getElementById('check').textContent='Checked';}</script></body></html>'''
exercise='''<!doctype html><html><body style="font:16px Arial;background:white"><main class="question-container"><p>What is the confidence level of the following confidence interval for μ?</p><math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mover><mi>x</mi><mo>¯</mo></mover><mo>±</mo><mn>1.645</mn><mo>(</mo><mfrac><mi>σ</mi><msqrt><mi>n</mi></msqrt></mfrac><mo>)</mo></mrow></math><div style="padding:25px 0"><label><input type="radio" name="answer" value="A"> A. 98%</label><br><label><input type="radio" name="answer" value="B"> B. 90%</label><br><label><input type="radio" name="answer" value="C"> C. 95%</label><br><label><input type="radio" name="answer" value="D"> D. 165%</label></div></main></body></html>'''
gemini='''<!doctype html><html><body style="font:16px Arial"><h1>Gemini mock</h1><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"></div></rich-textarea><input type="file" accept="image/*" id="upload"><button class="send-button" aria-label="Send message">Send</button><script>let hasImage=false;document.querySelector('#upload').addEventListener('change',e=>{hasImage=e.target.files.length>0;let img=document.createElement('img');img.src=URL.createObjectURL(e.target.files[0]);img.setAttribute('data-testid','attachment-thumb');img.width=60;document.body.appendChild(img);});document.querySelector('.send-button').onclick=()=>{window.sent={text:document.querySelector('.ql-editor').textContent,hasImage};setTimeout(()=>{const el=document.createElement('model-response');el.innerText='{"answers":["B"],"explanation":"1.645 is the 90% z critical value"}';document.body.appendChild(el);},500);};</script></body></html>'''
with tempfile.TemporaryDirectory(prefix='pearson-test-') as path:
    extension=Path(path)/'extension';shutil.copytree(root/'extension',extension)
    manifest=json.loads((extension/'manifest.json').read_text());manifest['host_permissions'].append('<all_urls>'); (extension/'manifest.json').write_text(json.dumps(manifest))
    with sync_playwright() as pw:
        context=pw.chromium.launch_persistent_context(str(Path(path)/'profile'),executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
        errors=[]
        context.on('page',lambda p:p.on('pageerror',lambda e:errors.append(str(e))))
        context.route('https://mylab.pearson.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=outer))
        context.route('https://tdx.acs.pearson.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=exercise))
        context.route('https://gemini.google.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=gemini))
        p=context.new_page();p.goto('https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=123',wait_until='domcontentloaded')
        p.frame_locator('iframe').locator('input[type=radio]').first.wait_for(timeout=10000)
        a=context.new_page();a.goto('https://gemini.google.com/app',wait_until='domcontentloaded');a.locator('rich-textarea').wait_for(timeout=10000)
        p.bring_to_front()
        sw=context.service_workers[0] if context.service_workers else None
        if sw is None:
            context.wait_for_event('serviceworker',timeout=15000)
            sw=context.service_workers[0]
        ext_id=sw.url.split('/')[2];print('Extension ID',ext_id)
        pop=context.new_page();pop.goto(f'chrome-extension://{ext_id}/popup.html');
        pop.locator('#start').wait_for(timeout=10000)
        pop.locator('input[name="model"][value="gemini"]').check()
        pop.locator('#includeVisual').check()
        pop.locator('#start').click()
        print('Start status:',pop.locator('#runStatus').inner_text())
        try:
            p.frame_locator('iframe').locator('input[value=B]').wait_for(timeout=15000)
            p.wait_for_function("document.querySelector('iframe').contentWindow === null || true")
            p.frame_locator('iframe').locator('input[value=B]').wait_for()
            expect=lambda: p.frame_locator('iframe').locator('input[value=B]').is_checked()
            limit=time.time()+20
            while not expect() and time.time()<limit:time.sleep(.5)
            print('selected B',expect())
            print('gemini sent',a.evaluate('window.sent'))
            print('status',pop.locator('#runStatus').inner_text())
        except Exception as exc:print('E2E failure',str(exc))
        print('errors',errors[:10]);context.close()
