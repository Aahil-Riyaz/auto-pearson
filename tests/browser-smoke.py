"""Mock-page-only smoke test; cannot verify actual Pearson or AI tab layout."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).parent.parent
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'), headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    page.on('pageerror', lambda error: print('Browser JS error:', error))
    html = (root / 'tests' / 'fixture.html').read_text().split('<script>')[0]
    page.set_content(html)
    page.evaluate('''() => {
      window.confirm = () => true;
      const listeners = []; window.testListeners = listeners;
      window.chrome = {
         runtime: {
           onMessage: { addListener: fn => listeners.push(fn) },
           sendMessage: async msg => {
             if(msg.type==='PEARSON_CONTROL' && msg.action==='start'){
               setTimeout(() => listeners.forEach(fn => fn({type:'PEARSON_START_FRAME'}, {}, () => {})), 20);
               return {ok:true,message:'Started.'};
             }
             if(msg.type==='PEARSON_REQUEST') {
               setTimeout(() => listeners.forEach(fn => fn({type:'PEARSON_REPLY',requestId:msg.requestId,answer:'{"answers":["Paris"],"explanation":"French capital"}'})), 80);
             }
             return {ok:true};
           }
         },
         storage: { sync: { get: async defaults => defaults }, onChanged: {addListener: () => {}} }
      };
    }''')
    page.add_script_tag(content=(root / 'extension' / 'answer-utils.js').read_text())
    page.add_script_tag(content=(root / 'extension' / 'math.js').read_text())
    page.add_script_tag(content=(root / 'extension' / 'pearson.js').read_text())
    page.wait_for_selector('#auto-pearson-widget')
    page.locator('#auto-pearson-widget').locator('button#start').click()
    page.wait_for_function("document.querySelector('input[value=Paris]').checked === true")
    page.wait_for_function("document.querySelector('#auto-pearson-widget').shadowRoot.querySelector('#status').textContent.includes('Review it')")
    status = page.locator('#auto-pearson-widget').locator('#status').inner_text()
    assert 'Review it' in status, status
    assert page.locator('#check').is_visible(), 'Pause-before-submit should NOT click Check Answer'
    page.locator('#auto-pearson-widget').locator('button#start').click()
    print('Mock-page smoke test passed: toolbar, AI reply, radio selection, review pause, stop')
    browser.close()
