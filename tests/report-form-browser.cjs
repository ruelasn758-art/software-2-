// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/report-form-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'puno-form-chrome-'));
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
  for (const [width,height] of [[1440,1000],[1100,900],[768,1024],[390,844],[320,740]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await cdp('Page.navigate',{url:'http://127.0.0.1:4174/nueva-incidencia.html?review='+width});
    for(let i=0;i<150;i++) {
      if(await evaluate('document.readyState==="complete" && document.querySelector("#category")?.dataset.source==="api"'))break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(await evaluate('document.querySelectorAll(".rf-progress li").length'),4);
    assert.equal(await evaluate('document.querySelector("#correct-information").tagName'),"DIV");
    assert.equal(await evaluate('document.querySelector("#correct-information summary")'),null);
    assert.equal(await evaluate('document.querySelector("#description").parentElement.hidden'),false);
    assert.equal(await evaluate('document.querySelector("#incidence-type").closest(".field").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#change-destination").open'),false);
    assert.equal(await evaluate('document.querySelector("#correct-information").hidden'),false);
    assert.equal(await evaluate('/Por identificar|Sin seleccionar|Sin especificar/.test(document.querySelector("#step-0").innerText)'),false);
    const {root:dom}=await cdp('DOM.getDocument');
    const {nodeId}=await cdp('DOM.querySelector',{nodeId:dom.nodeId,selector:'#photo-file'});
    await cdp('DOM.setFileInputFiles',{nodeId,files:[path.join(root,'assets/images/home/vias.jpg')]});
    for(let i=0;i<80;i++) {
      if(await evaluate('!document.querySelector("#correct-information").hidden'))break;
      await new Promise(r=>setTimeout(r,60));
    }
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#category").parentElement).display'),"none");
    await evaluate('document.querySelector("#choose-vias").click()');
    for(let i=0;i<80;i++) {
      if(await evaluate('!!document.querySelector("#destination").value'))break;
      await new Promise(r=>setTimeout(r,100));
    }
    const recommended=await evaluate('document.querySelector("#destination").value');
    await evaluate('[...document.querySelectorAll("#type-cards button")].find(b=>b.dataset.value).click()');
    assert.ok(await evaluate('document.querySelector("#incidence-type").value'));
    assert.equal(await evaluate('document.querySelector("#rf-type").parentElement.hidden'),false);
    await evaluate('[...document.querySelectorAll("#type-cards button")].find(b=>!b.dataset.value).click()');
    assert.equal(await evaluate('document.querySelector("#incidence-type").value'),"");
    assert.equal(await evaluate('document.querySelector("#retry-destinations").hidden'),true);
    // Simula únicamente el proveedor: catálogos, destino y resto de la página usan la API real.
    await evaluate(`window.aiCalls=0;window.originalFetch=window.fetch;window.fetch=async(url,options)=>{
      if(String(url).includes('/ia/analizar-incidencia')) {window.aiCalls++;await new Promise(r=>setTimeout(r,100));return {ok:true,json:async()=>({ok:true,analisis:{id_categoria:window.PunoCategories.getSelected().id_categoria,categoria:'Vías',id_tipo_incidencia:null,tipo:null,descripcion:'Descripción simulada únicamente para la prueba visual.',area_responsable:'Destino de prueba',confianza:null}})};}
      return window.originalFetch(url,options);
    };document.querySelector('#retry-analysis').click();document.querySelector('#retry-analysis').click();`);
    for(let i=0;i<100;i++){if(await evaluate('!document.querySelector("#ai-result").hidden'))break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await evaluate('window.aiCalls'),1);
    assert.equal(await evaluate('document.querySelector("#ai-result").hidden'),false);
    assert.match(await evaluate('document.querySelector("#description").value'),/Descripción simulada/);
    await evaluate('window.fetch=window.originalFetch;document.querySelector("#description").value="Descripción editada";document.querySelector("#description").dispatchEvent(new Event("input"));document.querySelector("#change-identification").click()');
    assert.equal(await evaluate('document.querySelector("#correct-information").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#restore-destination").hidden'),true);
    await evaluate('document.querySelector("#change-destination summary").click();[...document.querySelectorAll("#destination-cards button")].find(b=>b.getAttribute("aria-pressed")!=="true").click()');
    assert.notEqual(await evaluate('document.querySelector("#destination").value'),recommended);
    assert.equal(await evaluate('document.querySelector("#restore-destination").hidden'),false);
    if(width===390) {
      const metrics=await cdp('Page.getLayoutMetrics');
      const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});
      fs.writeFileSync(path.join(output,'cards-mobile.png'),Buffer.from(shot.data,'base64'));
    }
    assert.equal(await evaluate('document.querySelector("#rf-destination").textContent'),await evaluate('document.querySelector("#review-entity").textContent'));
    await evaluate('document.querySelector("#restore-destination").click()');
    assert.equal(await evaluate('document.querySelector("#destination").value'),recommended);
    await evaluate('document.querySelector("#change-destination summary").click()');
    for(let i=0;i<80;i++) {
      if(await evaluate('!document.querySelector("#photo-preview").hidden'))break;
      await new Promise(r=>setTimeout(r,60));
    }
    await evaluate('document.querySelector("#description").value="Bache en la calzada. Prueba visual sin enviar.";document.querySelector("#description").dispatchEvent(new Event("input"));document.querySelector("#use-manual-location").click();document.querySelector("#report-map").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));document.querySelector("#confirm-location").click()');
    await new Promise(r=>setTimeout(r,350));
    assert.equal(await evaluate('document.querySelector("#correct-information").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#incidence-type").closest(".field").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#change-destination").open'),false);
    const state=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,photo:!document.querySelector("#photo-preview").hidden,category:document.querySelector("#rf-category").textContent,destination:document.querySelector("#destination").value,sendEnabled:!document.querySelector("#send-report").disabled,confirmed:document.querySelector("#confirm-location").hidden,map:!!document.querySelector("#report-map .leaflet-pane"),progress:document.querySelectorAll(".rf-progress [data-complete=true]").length,sidebar:getComputedStyle(document.querySelector(".rf-sidebar")).display,ai:document.querySelector("#ai-status").textContent})');
    if(state.scroll>width) console.log(await evaluate('[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>'+width+' && e.getBoundingClientRect().width && !e.closest(".leaflet-pane")).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,40)'));
    assert.ok(state.scroll<=width,'Horizontal overflow '+JSON.stringify(state));
    assert.ok(state.photo && state.destination && state.sendEnabled && state.confirmed && state.map,JSON.stringify(state));
    assert.equal(state.progress,3,JSON.stringify({state,errors}));
    await evaluate('scrollTo(0,0)');
    const metrics=await cdp('Page.getLayoutMetrics');
    const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});
    fs.writeFileSync(path.join(output,width+'.png'),Buffer.from(shot.data,'base64'));
    await evaluate('document.querySelector("#change-location").click()');
    assert.equal(await evaluate('document.querySelector("#send-report").disabled'),true);
    await send('Browser.grantPermissions',{origin:'http://127.0.0.1:4174',permissions:['geolocation']});
    await cdp('Emulation.setGeolocationOverride',{latitude:-15.84,longitude:-70.02,accuracy:12});
    await evaluate('document.querySelector("#use-location").click()');
    for(let i=0;i<80;i++){if(await evaluate('!document.querySelector("#confirm-location").disabled'))break;await new Promise(r=>setTimeout(r,50));}
    await evaluate('document.querySelector("#confirm-location").click()');
    assert.equal(await evaluate('document.querySelector("#location-source-value").textContent'),'GPS');
    const confirmed=await evaluate('document.querySelector("#review-location").textContent');
    await cdp('Emulation.setGeolocationOverride',{latitude:-15.85,longitude:-70.03,accuracy:20});
    assert.equal(await evaluate('document.querySelector("#review-location").textContent'),confirmed);
    await evaluate('document.querySelector("#remove-photo").click()');
    assert.equal(await evaluate('document.querySelector("#send-report").disabled'),true);
    results.push(state);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({database:health.database,results,errors},null,2));
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({database:health.database,results,errors},null,2));
  await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
