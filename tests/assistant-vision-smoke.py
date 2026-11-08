"""AI bridge test with a simulated Gemini editor and image upload; no external network."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('''<rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"></div></rich-textarea><input type="file" accept="image/*"><button class="send-button" aria-label="Send message">Send</button><script>
    window.uploaded=false; document.querySelector('input[type=file]').addEventListener('change',e=>{window.uploaded=e.target.files.length===1;const pic=document.createElement('img');pic.src=URL.createObjectURL(e.target.files[0]);pic.setAttribute('data-testid','attachment');document.body.appendChild(pic);});
    document.querySelector('button').onclick=()=>{window.sent=document.querySelector('.ql-editor').textContent;setTimeout(()=>{const r=document.createElement('model-response');r.innerText='{"answers":["B"],"explanation":"the 90% choice"}';document.body.appendChild(r);},250)};
    </script>''')
    page.evaluate('''() => {window.handlers=[];window.messages=[];window.chrome={runtime:{onMessage:{addListener:f=>handlers.push(f)},sendMessage:async m=>{messages.push(m);return {ok:true};}}};}''')
    code=(root/'extension/assistant.js').read_text(encoding='utf-8').replace('location.hostname.startsWith(\'gemini.\')', 'true')
    page.add_script_tag(content=code)
    png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y1grxEAAAAASUVORK5CYII='
    page.evaluate('''image => {window.handlers.forEach(fn=>fn({type:'PEARSON_ASK',requestId:'test-1',question:'Which confidence level? Answer in JSON',screenshot:image},{},r=>{window.accepted=r}));}''',png)
    try:
        page.wait_for_function("window.messages.some(m=>m.type==='PEARSON_AI_RESULT')",timeout=16000)
        m=page.evaluate("window.messages.find(m=>m.type==='PEARSON_AI_RESULT')")
        assert m.get('answer') and '"B"' in m['answer'],m
        assert page.evaluate('window.uploaded') is True
        assert page.evaluate('window.sent').startswith('Which confidence level?')
        assert not errors, errors
        print('AI bridge PASS: image input → upload preview → Gemini prompt → new JSON reply.')
    except Exception as e:
        print('AI bridge FAIL:',e)
        print('messages:',page.evaluate('window.messages'))
        print('errors:',errors)
        raise
    finally:browser.close()
