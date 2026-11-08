"""Offline regression: screenshot forwarding must preserve a full-resolution PNG, not crop it."""
import base64
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
width,height=2048,1279
screenshot=Image.new('RGB',(width,height),'white')
d=ImageDraw.Draw(screenshot)
d.rectangle((0,0,width,180),fill='#12859c')
d.text((280,220),'Question 1: xbar +/- 1.645 * (sigma / sqrt(n))',fill='black')
d.text((280,380),'A. 98%     B. 90%     C. 95%     D. 165%',fill='black')
raw=BytesIO();screenshot.save(raw,'PNG')
with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':width,'height':height})
  page.set_content('<div>Mock Pearson</div>')
  page.evaluate('''() => {window.hand=[];window.chrome={runtime:{onMessage:{addListener:fn=>hand.push(fn)},sendMessage:async()=>({ok:true})},storage:{sync:{get:async d=>d},onChanged:{addListener:()=>{}}}}}''')
  for filename in ('answer-utils.js','math.js','pearson.js'):
    page.add_script_tag(content=(root/'extension'/filename).read_text())
  shot='data:image/png;base64,'+base64.b64encode(raw.getvalue()).decode()
  result=page.evaluate('''shot => new Promise(resolve => window.hand.forEach(fn=>fn({type:'PEARSON_CROP_IMAGE',shot}, {}, resolve)))''',shot)
  assert result['ok'],result
  data=base64.b64decode(result['image'].split(',')[1])
  assert data==raw.getvalue(), 'Full screenshot bytes must be unchanged'
  assert Image.open(BytesIO(data)).size==(width,height)
  assert result['rect']['mode']=='full-viewport'
  print('PASS: full screenshot preserved bit-for-bit at 2048 x 1279, without crop')
  browser.close()
