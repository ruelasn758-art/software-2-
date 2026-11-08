// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/incidence-map-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'puno-map-chrome-'));
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

  const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
  assert.equal(health.database,'puno_reporta_prueba_ia');

  const reports=await(await fetch('http://127.0.0.1:3001/api/reportes')).json();
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:'window.gpsCalls=0;Object.defineProperty(navigator,"geolocation",{value:{getCurrentPosition(){window.gpsCalls++}}})'});
  const results=[];
  const located=rows=>rows.filter(r=>Number.isFinite(r.latitud)&&Number.isFinite(r.longitud)&&Math.abs(r.latitud)<=90&&Math.abs(r.longitud)<=180);
  for(const [width,height] of [[1440,1000],[1024,900],[768,1024],[390,844],[320,740]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await cdp('Page.navigate',{url:'http://127.0.0.1:4174/nueva-incidencia.html'});
    for(let i=0;i<150;i++){if(await evaluate('document.readyState==="complete" && window.ReportStore'))break;await new Promise(r=>setTimeout(r,80));}
    await evaluate('document.querySelector("#rf-map-link").click()');
    for(let i=0;i<120;i++){if(await evaluate('document.querySelector("#map-count-total").textContent!=="—" && !document.querySelector("#map-refresh").disabled'))break;await new Promise(r=>setTimeout(r,80));}
    const markers=()=>evaluate('document.querySelectorAll("#incidents-map .incident-marker").length');
    assert.equal(Number(await evaluate('document.querySelector("#map-count-total").textContent')),reports.length);
    assert.equal(await markers(),located(reports).length);
    assert.equal(await evaluate('document.querySelectorAll("#incidents-map .incident-marker.reported").length'),located(reports).filter(r=>r.estado==='Reportado').length);
    await evaluate('document.querySelector("#incidents-map .incident-marker").click()');
    assert.equal(await evaluate('document.querySelector("#map-report-panel").hidden'),false);
    assert.equal(await evaluate('document.querySelectorAll("#incidents-map .selected").length'),1);
    const code=await evaluate('document.querySelector("#map-panel-code").textContent');
    assert.ok(reports.some(r=>r.codigo===code));
    await evaluate('document.querySelector("#map-panel-photo").decode().catch(()=>{})');
    assert.ok(await evaluate('document.querySelector("#map-panel-photo").naturalWidth>0 || !document.querySelector("#map-photo-empty").hidden'));
    await evaluate('scrollTo(0,0)');
    assert.ok(await evaluate('document.documentElement.scrollWidth')<=width,'overflow '+width);
    const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,width+'.png'),Buffer.from(shot.data,'base64'));
    await evaluate('document.querySelector("#map-open-detail").click()');assert.equal(await evaluate('document.querySelector("#detail-code").textContent'),code);
    await evaluate('document.querySelector("#rf-map-link").click()');
    for(let i=0;i<100;i++){if(await markers()>0)break;await new Promise(r=>setTimeout(r,50));}
    await evaluate('document.querySelector("#map-filter-state").value="Solucionado";document.querySelector("#map-filter-state").dispatchEvent(new Event("change"))');
    assert.equal(await markers(),located(reports).filter(r=>r.estado==='Solucionado').length);
    await evaluate('document.querySelector("#map-center").click()');
    await evaluate('document.querySelector("#map-filter-state").value="";document.querySelector("#map-filter-category").value='+JSON.stringify(reports[0].categoria)+';document.querySelector("#map-filter-category").dispatchEvent(new Event("change"))');
    assert.equal(await markers(),located(reports).filter(r=>r.categoria===reports[0].categoria).length);
    await evaluate('document.querySelector("#map-filter-category").value="";document.querySelector("#map-filter-period").value="7";document.querySelector("#map-filter-period").dispatchEvent(new Event("change"))');
    const now=await evaluate('Date.now()');
    assert.equal(await markers(),located(reports).filter(r=>Date.parse(r.fecha_registro)>=now-7*86400000&&Date.parse(r.fecha_registro)<=now).length);
    if(await markers()>0){await evaluate('document.querySelector("#incidents-map .incident-marker").click();document.querySelector("#map-panel-close").click()');assert.equal(await evaluate('document.querySelector("#map-report-panel").hidden'),true);}
    assert.equal(await evaluate('window.gpsCalls'),0);
    if(width===1440) {
      await cdp('Network.enable');
      await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
      await evaluate('document.querySelector("#map-refresh").click()');
      for(let i=0;i<120;i++){if(await evaluate('!document.querySelector("#map-refresh").disabled'))break;await new Promise(r=>setTimeout(r,100));}
      assert.equal(await markers(),0);
      assert.match(await evaluate('document.querySelector("#map-data-status").textContent'),/No pudimos/);
      await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await evaluate('document.querySelector("#map-filter-period").value="all";document.querySelector("#map-refresh").click()');
      for(let i=0;i<100;i++){if(await evaluate('!document.querySelector("#map-refresh").disabled'))break;await new Promise(r=>setTimeout(r,80));}
      assert.equal(await markers(),located(reports).length);
    }
    results.push({width,passed:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors}));
  await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
