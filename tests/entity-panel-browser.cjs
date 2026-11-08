// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/entity-panel-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'puno-entity-chrome-'));
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
  const authOptions=await require('./auth-session.cjs')(cdp,"entity");

  const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
  assert.equal(health.database,'puno_reporta_prueba_ia');


  const expected=await(await fetch('http://127.0.0.1:3001/api/entidad/vias/reportes',authOptions)).json();
  const results=[];
  const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);};
  for(const [width,height] of [[1440,1000],[1100,900],[768,1024],[390,844],[320,740]]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:'http://127.0.0.1:4174/nueva-incidencia.html?entity-review='+width+'#entidad-vias'});
    await wait('document.querySelector("#entity-total")?.textContent==='+JSON.stringify(String(expected.reportes.length))+' && !document.querySelector("#entity-refresh").disabled');
    assert.equal(await evaluate('document.querySelector("#entity-title").textContent'),expected.area.area);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".rf-sidebar")).display'),'none');
    assert.ok(await evaluate('[...document.querySelectorAll("#entity-report-list > li")].every(row=>row.querySelector(":scope > .roads-category") && row.querySelector(":scope > .roads-type") && row.querySelector(":scope > .roads-description"))'),'Columnas propias de Vías');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Desbordamiento '+width);
    assert.equal(await evaluate('document.querySelectorAll("#entity-report-list > li").length'),Math.min(5,expected.reportes.length),JSON.stringify({errors,ui:await evaluate('({page:document.querySelector("#entity-page-label").textContent,state:document.querySelector("#entity-filter-state").value,date:document.querySelector("#entity-filter-date").value,query:document.querySelector("#entity-search").value,load:document.querySelector("#entity-load-status").textContent,title:document.querySelector("#entity-list-title").textContent})')}));
    const missing=await evaluate('[...document.querySelectorAll("#entity-report-list img")].filter(i=>!i.hidden&&i.complete&&!i.naturalWidth).length');assert.equal(missing,0);
    await evaluate('document.querySelector("#entity-search").value="ningún resultado xyz";document.querySelector("#entity-search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll("#entity-report-list > li").length'),0);
    await evaluate('document.querySelector("#entity-search").value="";document.querySelector("#entity-search").dispatchEvent(new Event("input"))');
    if(expected.reportes.length>5){await evaluate('document.querySelector("#entity-next").click()');assert.ok((await evaluate('document.querySelector("#entity-page-label").textContent')).includes('Página 2'));await evaluate('document.querySelector("#entity-previous").click()');}
    await evaluate('document.querySelector("#entity-filter-state").value="Solucionado";document.querySelector("#entity-filter-state").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('[...document.querySelectorAll("#entity-report-list .entity-badge")].every(e=>e.textContent==="Solucionado")'),true);
    await evaluate('document.querySelector("#entity-filter-state").value="";document.querySelector("#entity-filter-state").dispatchEvent(new Event("input"))');
    await evaluate('document.querySelector("#entity-filter-date").value="7";document.querySelector("#entity-filter-date").dispatchEvent(new Event("input"))');
    assert.ok(await evaluate('[...document.querySelectorAll("#entity-report-list time")].every(e=>Date.parse(e.dateTime)>=Date.now()-7*86400000)'),'Filtro de fecha');
    await evaluate('document.querySelector("#entity-filter-date").value="";document.querySelector("#entity-filter-date").dispatchEvent(new Event("input"))');
    const metrics=await cdp('Page.getLayoutMetrics');const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});fs.writeFileSync(path.join(output,width+'.png'),Buffer.from(shot.data,'base64'));
    if(expected.reportes.length){await evaluate('document.querySelector("#entity-report-list button").click()');assert.equal(await evaluate('document.querySelector("#entity-report-detail").hidden'),false);assert.ok(await evaluate('document.querySelector("#entity-detail-code").textContent'));assert.ok(await evaluate('!!document.querySelector("#entity-detail-map .leaflet-pane")'));await evaluate('document.querySelector("#entity-detail-back").click()');await wait('!document.querySelector("#entity-refresh").disabled');}
    await evaluate('document.querySelector("#entity-nav-progress").click()');await wait('!document.querySelector("#entity-refresh").disabled');
    assert.equal(await evaluate('document.querySelector("#entity-nav-progress").getAttribute("aria-current")'),'page');
    results.push({width,reports:expected.reportes.length,overflow:false});
  }
  await cdp('Network.enable');await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate('document.querySelector("#entity-refresh").click()');await wait('!document.querySelector("#entity-refresh").disabled');
  assert.match(await evaluate('document.querySelector("#entity-load-status").textContent'),/No pudimos/);
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate('location.hash="#entidad-limpieza"');await wait('!document.querySelector("#entity-refresh").disabled && document.querySelector("#entity-title").textContent.includes("Obras Públicas")');
  assert.equal(await evaluate('PunoAuth.current.usuario.id_area_responsable'),String(expected.area.id_area));
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await evaluate('PunoAuth.logout()');await wait('location.pathname.endsWith("iniciar-sesion.html")');
  await evaluate('history.back()');
  await wait('location.pathname.endsWith("iniciar-sesion.html") && document.readyState==="complete"');
  await cdp('Page.navigate',{url:'http://127.0.0.1:4174/nueva-incidencia.html#entidad-vias'});
  await wait('location.pathname.endsWith("iniciar-sesion.html") && document.readyState==="complete"');
  assert.equal(errors.length,0,JSON.stringify(errors));console.log(JSON.stringify({database:health.database,results,errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
