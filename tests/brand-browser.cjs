// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/brand-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-chrome-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { windowsHide: true });
let socket;
(async () => {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome no inició')), 20000);
    let stderr = '';
    chrome.on('error', reject);
    chrome.stderr.on('data', b => {
      stderr += b;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Conexi?n CDP bloqueada')), { once:true }); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const request = ++id; pending.set(request, { resolve, reject });
    socket.send(JSON.stringify({ id: request, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const value = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  await cdp('Runtime.enable');


  const results=[];
  for(const [width,height] of [[1440,1000],[1024,900],[768,1024],[390,844]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    for(const page of ['index.html','iniciar-sesion.html','crear-cuenta.html','nueva-incidencia.html#inicio','nueva-incidencia.html','nueva-incidencia.html#entidad-vias']) {
      const [base,hash]=page.split('#');
      await cdp('Page.navigate',{url:'http://127.0.0.1:4174/'+base+'?brand-review='+width+(hash?'#'+hash:'')});
      for(let n=0;n<100;n++) {if(await evaluate('document.readyState==="complete" && !!globalThis.PlatformBrand'))break;await new Promise(r=>setTimeout(r,50));}
      const state=await evaluate('({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,logos:[...document.querySelectorAll("img[data-brand-logo]")].map(i=>({src:i.getAttribute("src"),loaded:i.complete&&i.naturalWidth>0,fit:getComputedStyle(i).objectFit})),favicon:document.querySelector("link[rel=icon]").getAttribute("href"),name:PlatformBrand.name})');
      assert.doesNotMatch(state.text,/PUNO REPORTA/i);assert.equal(state.overflow,false,page+" "+width);assert.equal(state.name,"");
      assert.ok(state.logos.length);assert.ok(state.logos.every(i=>i.src==='assets/logo-symbol.png'&&i.loaded&&i.fit==='contain'));assert.equal(state.favicon,'assets/logo-symbol.png');
      results.push({page,width,logos:state.logos.length});
      if((width===1440||width===390)&&['index.html','nueva-incidencia.html#entidad-vias'].includes(page)){
        const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,width+'-'+(hash||'home')+'.png'),Buffer.from(shot.data,'base64'));
      }
    }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
