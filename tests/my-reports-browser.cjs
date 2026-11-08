// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/my-reports-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'puno-reports-chrome-'));
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
    await cdp('Page.navigate',{url:'http://127.0.0.1:4174/nueva-incidencia.html'});
    for(let i=0;i<150;i++){if(await evaluate('document.readyState==="complete" && window.ReportStore'))break;await new Promise(r=>setTimeout(r,80));}
    await evaluate('document.querySelector("#citizen-reports").click()');
    for(let i=0;i<100;i++){if(await evaluate('document.querySelector("#temporary-report-list").children.length>0'))break;await new Promise(r=>setTimeout(r,80));}
    const codes=()=>evaluate('[...document.querySelectorAll(".report-list-code")].map(e=>e.textContent)');
    assert.equal(Number(await evaluate('document.querySelector("#reports-count-total").textContent')),reports.length);
    assert.equal((await codes()).length,Math.min(5,reports.length));
    await evaluate('Promise.all([...document.querySelectorAll(".report-list-photo img")].map(i=>i.decode().catch(()=>{})))');
    assert.ok(await evaluate('[...document.querySelectorAll(".report-list-photo img")].every(i=>i.hidden||i.naturalWidth>0)'));
    await evaluate('scrollTo(0,0)');
    assert.ok(await evaluate('document.documentElement.scrollWidth')<=width);
    const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,width+'.png'),Buffer.from(shot.data,'base64'));
    if(reports.length>5){const first=await codes();await evaluate('document.querySelector("#reports-next").click()');assert.notDeepEqual(await codes(),first);await evaluate('document.querySelector("#reports-prev").click()');assert.deepEqual(await codes(),first);}
    const code=reports[0].codigo;
    await evaluate('document.querySelector("#reports-search").value='+JSON.stringify(code)+';document.querySelector("#reports-search").dispatchEvent(new Event("input"))');
    assert.deepEqual(await codes(),[code]);
    await evaluate('document.querySelector(".report-list-open").click()');
    assert.equal(await evaluate('document.querySelector("#detail-code").textContent'),code);
    assert.equal(await evaluate('document.querySelector("#detail-history").children.length'),reports[0].historial.length);
    await evaluate('scrollTo(0,0)');
    assert.ok(await evaluate('document.documentElement.scrollWidth')<=width);
    const detailShot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'detail-'+width+'.png'),Buffer.from(detailShot.data,'base64'));
    await evaluate('document.querySelector("#detail-back").click()');
    for(let i=0;i<80;i++){if(await evaluate('document.querySelector("#temporary-report-list").children.length>0'))break;await new Promise(r=>setTimeout(r,50));}
    await evaluate('document.querySelector("#reports-clear").click();document.querySelector("#reports-state").value="Solucionado";document.querySelector("#reports-state").dispatchEvent(new Event("change"))');
    assert.equal((await codes()).length,Math.min(5,reports.filter(r=>r.estado==='Solucionado').length));
    await evaluate('document.querySelector("#reports-clear").click();document.querySelector("#reports-category").value='+JSON.stringify(reports[0].categoria)+';document.querySelector("#reports-category").dispatchEvent(new Event("change"))');
    assert.equal((await codes()).length,Math.min(5,reports.filter(r=>r.categoria===reports[0].categoria).length));
    await evaluate('document.querySelector("#reports-clear").click();document.querySelector("#reports-order").value="oldest";document.querySelector("#reports-order").dispatchEvent(new Event("change"))');
    assert.equal((await codes())[0],[...reports].sort((a,b)=>Date.parse(a.fecha_registro)-Date.parse(b.fecha_registro)||a.codigo.localeCompare(b.codigo))[0].codigo);
    await evaluate('document.querySelector("#reports-search").value="NO-EXISTE-RESULTADO";document.querySelector("#reports-search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelector("#reports-empty").hidden'),false);
    results.push({width,passed:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors}));
  await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
