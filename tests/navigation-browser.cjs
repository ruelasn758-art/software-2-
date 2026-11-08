// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/navigation-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'puno-nav-chrome-'));
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
  const authOptions=await require('./auth-session.cjs')(cdp,"citizen");

  const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
  assert.equal(health.database,'puno_reporta_prueba_ia');

  const results=[];
  for(const [width,height] of [[1440,1000],[1024,900],[768,1024],[390,844],[320,740]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await cdp('Page.navigate',{url:'http://127.0.0.1:4174/nueva-incidencia.html#inicio'});
    for(let i=0;i<150;i++){if(await evaluate('document.readyState==="complete" && document.querySelector("#dashboard-recent")?.children.length>0'))break;await new Promise(r=>setTimeout(r,80));}
    let baseline;
    for(const [id,screen] of [['citizen-home','dashboard'],['citizen-report','form'],['citizen-reports','reports'],['rf-map-link','map'],['citizen-home','dashboard']]) {
      await evaluate('document.getElementById('+JSON.stringify(id)+').click()');
      for(let i=0;i<100;i++){
        if(await evaluate('document.querySelector("#citizen-shell").dataset.screen==='+JSON.stringify(screen)+' && ![document.querySelector("#reports-data-status").textContent,document.querySelector("#dashboard-data-status").textContent,document.querySelector("#map-data-status").textContent].some(t=>t.includes("Cargando"))'))break;
        await new Promise(r=>setTimeout(r,60));
      }
      await evaluate('scrollTo(0,0)');
      await new Promise(r=>setTimeout(r,120));
      const state=await evaluate('(()=>{const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100)};return {screen:document.body.dataset.screen,sidebar:rect(document.querySelector(".rf-sidebar")),header:rect(document.querySelector(".site-header")),left:rect(document.querySelector("main"))[0],mainWidth:rect(document.querySelector("main"))[2],nav:[...document.querySelectorAll(".rf-sidebar button")].map(rect),active:[...document.querySelectorAll(".rf-sidebar [aria-current=page]")].map(e=>e.id),menus:document.querySelectorAll(".rf-sidebar nav, .citizen-nav").length,scroll:document.documentElement.scrollWidth,map:!!document.querySelector("#incidents-map .leaflet-pane")}})()');
      assert.equal(state.screen,screen);
      assert.deepEqual(state.active,[id]);
      assert.equal(state.menus,1);
      assert.ok(state.scroll<=width,'Overflow '+JSON.stringify(state));
      const geometry={sidebar:state.sidebar,header:state.header,left:state.left,mainWidth:state.mainWidth,nav:state.nav};
      if(!baseline)baseline=geometry;else assert.deepEqual(geometry,baseline,'Layout changed '+width+' '+screen);
      if(screen==='map')assert.equal(state.map,true);
      if(screen==='form')await evaluate('document.querySelector("#description").value="Borrador conservado";document.querySelector("#description").dispatchEvent(new Event("input"))');
      results.push({width,...state});
    }
    await evaluate('document.querySelector("#citizen-report").click()');
    assert.equal(await evaluate('document.querySelector("#description").value'),'Borrador conservado');
    await evaluate('document.querySelector("#citizen-home").click()');
    await new Promise(r=>setTimeout(r,250));
    await evaluate('scrollTo(0,0)');
    const shot=await cdp('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(output,width+'.png'),Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
  console.log('PASS: 25 transiciones, geometría idéntica, un menú, estado activo, mapa y borrador conservado. Sin errores JS.');
  await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
