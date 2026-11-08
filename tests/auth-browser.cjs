// Revisión real de la portada con Chrome headless y CDP, sin dependencias.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/auth-review');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'puno-auth-chrome-'));
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
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
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

  const results = [];
  for (const page of ['iniciar-sesion.html','crear-cuenta.html']) {
    const registration = page === 'crear-cuenta.html';
    for (const [width,height] of [[1440,1000],[1024,900],[768,1024],[390,844],[320,740]]) {
      await cdp('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<600});
      await cdp('Page.navigate',{url:'http://127.0.0.1:4174/'+page});
      for(let n=0;n<100;n++) {
        if(await evaluate('document.readyState === "complete" && Boolean(document.querySelector("#password-toggle"))'))break;
        await new Promise(r=>setTimeout(r,50));
      }
      await evaluate('Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))');
      const state=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,images:[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src)})');
      assert.ok(state.scroll<=state.width); assert.deepEqual(state.images,[]);
      assert.equal(await evaluate('document.querySelector("#auth-form").checkValidity()'),false);
      await evaluate('document.querySelector("#password").value="test-only-password";document.querySelector("#password-toggle").click()');
      assert.equal(await evaluate('document.querySelector("#password").type'),'text');
      assert.equal(await evaluate('document.querySelector("#password-toggle").getAttribute("aria-pressed")'),'true');
      await evaluate('document.querySelector("#password-toggle").click()');
      assert.equal(await evaluate('document.querySelector("#password").type'),'password');
      await evaluate('document.querySelector("#email").value="invalid"');
      assert.equal(await evaluate('document.querySelector("#auth-form").checkValidity()'),false);
      await evaluate('document.querySelector("#email").value="";document.querySelector("#password").value="";document.activeElement.blur()');
      const metrics=await cdp('Page.getLayoutMetrics');
      const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});
      fs.writeFileSync(path.join(output,page+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      results.push({page,...state});
    }
    const credentials=registration
      ? {correo:'ciudadano.auth.'+Date.now()+'@prueba.invalid',password:require('node:crypto').randomBytes(24).toString('base64url')}
      : JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'puno-vias-test-credentials.json'),'utf8'));
    await evaluate('sessionStorage.clear();document.querySelector("#email").value='+JSON.stringify(credentials.correo)+';document.querySelector("#password").value='+JSON.stringify(credentials.password));
    if(registration) {
      assert.equal(await evaluate('document.querySelector("#auth-form").checkValidity()'),false);
      await evaluate('document.querySelector("#full-name").value="Ciudadano de prueba"');
    }
    assert.equal(await evaluate('document.querySelector("#auth-form").checkValidity()'),true);
    const expected=registration?'iniciar-sesion.html':'crear-cuenta.html';
    assert.equal(await evaluate('document.querySelector("#auth-switch").getAttribute("href")'),expected);
    await evaluate('document.querySelector("#auth-submit").click()');
    for(let n=0;n<100;n++) {
      if(await evaluate('location.pathname.endsWith("nueva-incidencia.html")'))break;
      await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(await evaluate('location.pathname+location.hash'),registration?'/nueva-incidencia.html#inicio':'/nueva-incidencia.html#entidad');
    for(let n=0;n<100;n++){if(await evaluate('Boolean(globalThis.PunoAuth?.current)'))break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await evaluate('PunoAuth.current.usuario.rol'),registration?'CIUDADANO':'ENTIDAD');
    assert.equal(await evaluate('sessionStorage.getItem("puno-reporta-demo-session")'),null);
    if(registration)fs.writeFileSync(path.join(os.tmpdir(),'puno-citizen-test-credentials.json'),JSON.stringify(credentials),{mode:0o600});
    await evaluate('PunoAuth.logout()');
    await cdp('Page.navigate',{url:'http://127.0.0.1:4174/'+page});
    for(let n=0;n<100;n++) { if(await evaluate('document.readyState==="complete" && Boolean(document.querySelector("#auth-switch"))'))break; await new Promise(r=>setTimeout(r,50)); }
    await evaluate('document.querySelector("#auth-switch").click()');
    for(let n=0;n<100;n++) { if(await evaluate('location.pathname.endsWith('+JSON.stringify(expected)+')'))break; await new Promise(r=>setTimeout(r,50)); }
    assert.equal(await evaluate('location.pathname'),'/'+expected);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({results,errors,validations:'passed',existingSessionFlow:'passed',passwordToggle:'passed',navigation:'passed'},null,2));
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
  await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{socket?.close();chrome.kill()});
