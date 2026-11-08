"""Offline popup UI test with mocked Chrome extension APIs."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context()
    errors=[]
    context.add_init_script('''() => {}''')
    context.add_init_script('''
      window.chrome = {
        runtime:{
          getManifest:()=>({version:'0.4.0'}),
          sendMessage:async (msg) => {
            if(msg.action==='scan') return {ok:true,selected:{frameId:7,type:'multiple_choice',controls:4},frames:[{frameId:0,origin:'https://mylab.pearson.com',controls:0,question:false,type:'unknown'}, {frameId:7,origin:'https://exercise.pearsoncmg.com',controls:4,question:true,type:'multiple_choice'}],missing:[]};
            if(msg.action==='start') return {ok:true,message:'Started in frame 7 (multiple choice).'};
            if(msg.action==='stop') return {ok:true,message:'Stopped.'};
            return {ok:true,status:'Ready'};
          }
        },
        tabs:{
          query:async q => q.active ? [{id:44,title:'Pearson Homework 4',url:'https://mylab.pearson.com/Student/PlayerHomework.aspx'}] : [],
          onCreated:{addListener:()=>{}},onRemoved:{addListener:()=>{}}
        },
        storage:{sync:{get:async d => d,set:async () => {} }, session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}
      };
    ''')
    page=context.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    html=(root/'extension/popup.html').read_text().replace('<script src="popup.js"></script>', '')
    page.set_content(html)
    page.add_script_tag(content=(root/'extension/popup.js').read_text())
    page.locator('#start').wait_for()
    assert page.locator('#start').is_enabled()
    assert page.locator('#stop').is_enabled()
    assert page.locator('#version').inner_text()=='v0.4.0'
    assert page.locator('body').evaluate('(el) => Math.round(el.getBoundingClientRect().width)')>=490
    page.locator('#scan').click()
    page.wait_for_function("document.querySelector('#runStatus').textContent.includes('Detected')")
    page.locator('#start').click()
    page.wait_for_function("document.querySelector('#runStatus').textContent.includes('Started')")
    page.locator('#stop').click()
    page.wait_for_function("document.querySelector('#runStatus').textContent.includes('Stopped')")
    assert not errors,errors
    print('Popup smoke test passed: wider panel, Start, Stop, Scan frames, version, selected tab.')
    browser.close()
