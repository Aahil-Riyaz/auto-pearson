(() => {
  'use strict';
  if (window.__autoPearsonAssistantV4) return;
  window.__autoPearsonAssistantV4 = true;

  const model = location.hostname.startsWith('gemini.') ? 'gemini' : location.hostname.includes('deepseek') ? 'deepseek' : 'chatgpt';
  const config = {
    gemini: {
      composer:['rich-textarea .ql-editor[contenteditable="true"]','.ql-editor[contenteditable="true"]','div[contenteditable="true"][role="textbox"]','rich-textarea [contenteditable="true"]'],
      send:['button.send-button:not(.stop)','button[aria-label="Send message"]','button[aria-label*="Send"]','.send-button button','button[mattooltip*="Send"]'],
      messages:['model-response','.model-response']
    },
    chatgpt: {
      composer:['#prompt-textarea','[contenteditable="true"][data-testid*="prompt"]','textarea'],
      send:['[data-testid="send-button"]','button[aria-label="Send prompt"]','button[aria-label="Send message"]'],
      messages:['[data-message-author-role="assistant"]','[data-testid="conversation-turn-assistant"]']
    },
    deepseek: {
      composer:['textarea','[contenteditable="true"]'],
      send:['button[aria-label*="Send"]','button[aria-label*="send"]'],
      messages:['.ds-markdown','[class*="markdown"]']
    }
  }[model];
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const visible=el=>Boolean(el && el.getClientRects().length);
  function firstVisible(selectors){for(const s of selectors){const e=[...document.querySelectorAll(s)].find(visible);if(e)return e;}return null;}
  function responses(){const all=[...document.querySelectorAll(config.messages.join(','))].filter(visible);return all.filter(e=>!all.some(parent=>parent!==e && parent.contains(e)));}
  function lastResponse(){return responses().at(-1)?.innerText?.trim()||'';}
  function generating(){return Boolean(document.querySelector('button.send-button.stop,[data-testid="stop-button"],button[aria-label*="Stop generating"],button[aria-label*="Stop response"]'));}
  async function waitUntil(fn,ms=10000){const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await delay(220);}return null;}
  function status(requestId,stage){chrome.runtime.sendMessage({type:'PEARSON_AI_STATUS',requestId,stage}).catch(()=>{});}

  function writeComposer(el,text){
    el.focus();
    if(el.matches('textarea,input')){
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,text);
    } else {
      const sel=window.getSelection(),r=document.createRange();r.selectNodeContents(el);sel.removeAllRanges();sel.addRange(r);
      if (!document.execCommand('insertText',false,text)) el.textContent=text;
    }
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return (el.value??el.textContent??'').includes(text.slice(0,28));
  }

  function previewCount(){
    return document.querySelectorAll('img[src^="blob:"],img[src^="data:image"],file-preview,.file-preview,.attachment-preview,[data-testid*="attachment"],[data-testid*="file-chip"],uploaded-file').length;
  }
  async function attachScreenshot(data,requestId){
    if(typeof data!=='string'||!/^data:image\/(jpeg|png);base64,/.test(data))throw new Error('Invalid screenshot image.');
    const blob=await (await fetch(data)).blob();
    const file=new File([blob],'pearson-visible-question.jpg',{type:blob.type||'image/jpeg'});
    const before=previewCount();
    const transfer=new DataTransfer();transfer.items.add(file);
    const editor=await waitUntil(()=>firstVisible(config.composer));
    if(!editor) throw new Error('No AI text composer is visible.');
    status(requestId,`Attaching question image in ${model}…`);
    // Gemini and several other chat composers accept image paste events directly.
    try{
      editor.focus();editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
      if(await waitUntil(()=>previewCount()>before,3200)){ await delay(700);return 'paste'; }
    }catch{}
    // Fallback: use the site's own file upload input, if present. Never access OS files.
    const findInput=()=>[...document.querySelectorAll('input[type="file"]')].find(el=>!el.disabled && (!el.accept||/image|\*/i.test(el.accept)));
    let input=findInput();
    if(!input){
      // Suppress only the native OS file-picker action while exposing Gemini's
      // dynamic upload input. No local files or passwords are accessed.
      const suppressPicker=event=>{
        if(event.target instanceof HTMLInputElement && event.target.type==='file') event.preventDefault();
      };
      document.addEventListener('click',suppressPicker,true);
      try {
        const menu=firstVisible(['button[aria-label*="Open upload file menu"]','button[aria-label*="Add files"]','button[aria-label*="Upload"]','button[aria-label*="Attach"]','button[aria-label*="Add"]']);
        if(menu) {menu.click();await delay(320);}
        let upload=[...document.querySelectorAll('button,[role="menuitem"]')].find(el=>visible(el)&&/^(upload files?|upload images?|files? from (?:computer|device)|browse files?)$/i.test((el.innerText||el.getAttribute('aria-label')||'').trim()));
        if(upload) {upload.click();await delay(350);}
        input=findInput();
      } finally { document.removeEventListener('click',suppressPicker,true); }
    }
    if(!input)throw new Error(`${model} did not accept pasted image and no upload input was found. Its image-upload UI needs an adapter update.`);
    input.files=transfer.files;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    if(!input.files?.length)throw new Error(`${model} rejected the screenshot file.`);
    const appeared=await waitUntil(()=>previewCount()>before,6000);
    if(!appeared)throw new Error(`Screenshot sent to ${model}'s upload input but no attachment preview appeared. Stopping before submission rather than sending text without the image.`);
    await delay(900);
    return 'file-input';
  }

  let request=null;
  async function run(job){
    const id=job.requestId;
    const outdated=()=>request!==job;
    status(id,`Reading ${model}'s message editor…`);
    const editor=await waitUntil(()=>firstVisible(config.composer),12000);
    if(!editor)throw new Error(`Cannot find ${model}'s prompt box. Make sure you're logged in and on its chat screen.`);
    const previousNodes=responses();
    const lastNode=previousNodes.at(-1)||null, priorText=lastNode?.innerText||'';
    if(job.screenshot) await attachScreenshot(job.screenshot,id);
    if(outdated())return;
    status(id,`Sending prompt to ${model}…`);
    const text=job.question+(job.screenshot?'\n\nIMPORTANT: The attached image is the authoritative source for mathematical formulas and answer options. Read the actual image. If a formula is clipped or illegible, return an empty answers array; do not guess.':'');
    if(!writeComposer(editor,text)) throw new Error(`${model} did not accept the question text.`);
    const button=await waitUntil(()=>{const el=firstVisible(config.send);return el&&!el.disabled?el:null;},9000);
    if(!button)throw new Error(`${model} send button was not found or stayed disabled. The UI may have changed.`);
    button.click();
    if(outdated())return;
    await delay(1100);
    status(id,`Waiting for ${model}'s completed response…`);
    let old='',steady=0;
    const deadline=Date.now()+175000;
    while(Date.now()<deadline){
      if(outdated())return;
      const nodes=responses(),node=nodes.at(-1)||null;
      const contents=node?.innerText?.trim()||'';
      const newlyGenerated=Boolean(node && (node!==lastNode || contents!==priorText));
      if(newlyGenerated && contents.length>10 && !generating()){
        steady=contents===old?steady+1:0;
        if(steady>=4){
          status(id,`Answer received from ${model}.`);
          return contents;
        }
      }else steady=0;
      old=contents;
      await delay(700);
    }
    throw new Error(`${model} did not produce a completed answer within the timeout. Check the Gemini tab for errors or rate limits.`);
  }

  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.type==='PEARSON_AI_PING'){reply({ok:true,model,busy:!!request});return;}
    if(msg.type==='PEARSON_AI_CANCEL'){
      if(request?.requestId===msg.requestId)request=null;
      reply({ok:true});return;
    }
    if(msg.type!=='PEARSON_ASK')return;
    if(request){reply({ok:false,error:'The assistant tab is already handling a question.'});return;}
    request={requestId:msg.requestId,question:msg.question,screenshot:msg.screenshot};
    const job=request;
    reply({ok:true});
    run(job).then(answer=>{if(request===job)return chrome.runtime.sendMessage({type:'PEARSON_AI_RESULT',requestId:job.requestId,answer});})
      .catch(error=>{if(request===job)return chrome.runtime.sendMessage({type:'PEARSON_AI_RESULT',requestId:job.requestId,error:error.message||String(error)});})
      .catch(console.error)
      .finally(()=>{if(request===job)request=null;});
  });
})();
