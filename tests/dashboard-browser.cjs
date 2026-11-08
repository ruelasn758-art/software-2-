// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/dashboard-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'puno-dashboard-chrome-'));
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
  const reports=await(await fetch('http://127.0.0.1:3001/api/reportes',authOptions)).json();
  const results=[];
  for(const [width,height] of [[1440,1000],[1024,900],[768,1024],[390,844],[320,740]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await cdp('Page.navigate',{url:'http://127.0.0.1:4174/nueva-incidencia.html?viewport='+width+'#inicio'});
    for(let n=0;n<250;n++) {
      if(await evaluate('document.readyState === "complete" && document.querySelector("#dashboard-recent")?.children.length > 0'))break;
      await new Promise(r=>setTimeout(r,60));
    }
    await evaluate('Promise.all([...document.querySelectorAll("#citizen-dashboard img")].map(i=>i.decode().catch(()=>{})))');
    const state=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,total:Number(document.querySelector("#dashboard-total").textContent),recent:document.querySelector("#dashboard-recent").children.length,codes:[...document.querySelectorAll("#dashboard-recent strong")].map(e=>e.textContent),map:!!document.querySelector("#dashboard-map .leaflet-pane"),markers:document.querySelectorAll("#dashboard-map .leaflet-marker-icon").length,activity:document.querySelector("#dashboard-activity").children.length,apiStatus:document.querySelector("#dashboard-data-status").textContent})');
    console.log(JSON.stringify({state,errors}));
    assert.ok(state.scroll<=state.width,'Horizontal overflow '+width);
    assert.equal(state.total,reports.length);
    assert.equal(state.recent,Math.min(5,reports.length));
    assert.deepEqual(state.codes,reports.slice(0,5).map(r=>r.codigo));
    assert.equal(state.apiStatus,'');
    if(state.map)assert.equal(state.markers,reports.filter(r=>r.latitud!==null&&r.longitud!==null).length);
    assert.equal(state.activity,Math.min(4,reports.length));
    await new Promise(r=>setTimeout(r,600));
    const metrics=await cdp('Page.getLayoutMetrics');
    const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});
    fs.writeFileSync(path.join(output,width+'.png'),Buffer.from(shot.data,'base64'));
    await evaluate('document.querySelector("#dashboard-recent button").click()');
    assert.equal(await evaluate('document.querySelector("#report-detail").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#detail-code").textContent'),reports[0].codigo);
    await evaluate('document.querySelector("#citizen-home").click()');
    for(let n=0;n<100;n++){if(await evaluate('document.querySelector("#dashboard-recent").children.length>0'))break;await new Promise(r=>setTimeout(r,30));}
    await evaluate('document.querySelector("#dashboard-create").click()');
    assert.equal(await evaluate('document.querySelector("#incidence-form").hidden'),false);
    results.push(state);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({database:health.database,results,errors},null,2));
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({database:health.database,results,errors},null,2));
  await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
