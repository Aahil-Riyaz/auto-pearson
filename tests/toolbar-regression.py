"""Regression: Start button appears on Pearson Homework page even if question parsing fails."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).parent.parent

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('<!doctype html><html><body><header>Pearson</header><h1>Homework 4</h1><p>Custom question placeholder</p></body></html>')
    page.evaluate('''() => {
      window.chrome = {
        runtime: {onMessage:{addListener:()=>{}},sendMessage:async(msg)=>msg.type==='PEARSON_CONTROL'?{ok:false,error:'Scanned frames; no answer controls detected.'}:{ok:true}},
        storage: {sync:{get:async d=>d},onChanged:{addListener:()=>{}}}
      };
    }''')
    page.add_script_tag(content=(root / 'extension' / 'answer-utils.js').read_text())
    script=(root / 'extension' / 'pearson.js').read_text()
    marker='const isHomeworkPlayer = () => /(?:playerhomework|homework)/i.test(location.pathname) && window === window.top;'
    assert marker in script
    # Simulate the true path predicate without attempting network or filesystem navigation.
    script=script.replace(marker, 'const isHomeworkPlayer = () => window === window.top;')
    page.add_script_tag(content=(root / 'extension' / 'math.js').read_text())
    page.add_script_tag(content=script)
    toolbar=page.locator('#auto-pearson-widget')
    toolbar.wait_for()
    assert toolbar.locator('#start').inner_text() == 'Start'
    assert 'no standard answer controls' in toolbar.locator('#status').inner_text().lower()
    toolbar.locator('#start').click()
    assert 'no answer controls detected' in toolbar.locator('#status').inner_text().lower()
    assert not errors, errors
    print('Regression passed: Start visible on Pearson homework URL even when question detector cannot recognize a problem.')
    browser.close()
