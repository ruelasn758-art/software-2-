const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const context = await browser.newContext({ignoreHTTPSErrors:true, viewport:{width:390,height:844}});
  await context.addCookies([{name:'session',value:process.env.MOBILE_TEST_COOKIE,url:process.env.MOBILE_TEST_URL}]);
  await context.addInitScript(() => {
   window.Worker = class {
    constructor(){window.fotoWorker=this;}
    postMessage(data){this.ultimo=data;}
    terminate(){}
    resultado(categoria,id=this.ultimo.id){this.onmessage({data:{id,tipo:'resultado',categoria}});}
   };
  });
  const page = await context.newPage();
  // La IA y la seleccion manual deben funcionar incluso sin Leaflet.
  await page.route('**/leaflet.js', route => route.abort());
  await page.goto(process.env.MOBILE_TEST_URL+'/reportar',{waitUntil:'networkidle'});
  const foto=path.join(__dirname,'../static/img/logo.png');
  let numero=0;
  const upload=async()=>{
   const anterior=await page.evaluate(()=>window.fotoWorker?.ultimo?.id || 0);
   await page.locator('#foto').setInputFiles({name:`prueba-${++numero}.png`,mimeType:'image/png',buffer:fs.readFileSync(foto)});
   await page.waitForFunction(id=>window.fotoWorker?.ultimo?.id > id,anterior);
  };
  await upload();
  await page.evaluate(()=>fotoWorker.resultado('Basura'));
  assert.match(await page.locator('#foto-analisis').textContent(),/Posible incidencia detectada: Basura/);
  assert.equal(await page.locator('.cat-pick.activo').getAttribute('data-categoria'),'Basura');
  await page.locator('#cambiar-categoria').click();
  await page.locator('[data-categoria="Fuga"]').click();
  assert.equal(await page.locator('.cat-pick.activo').getAttribute('data-categoria'),'Fuga');
  assert.match(await page.locator('#area-hint').textContent(),/EMSAPUNO/);
  await upload();
  await page.locator('[data-categoria="Bache"]').click();
  await page.evaluate(()=>fotoWorker.resultado('Basura'));
  assert.equal(await page.locator('.cat-pick.activo').getAttribute('data-categoria'),'Bache');
  const viejo=await page.evaluate(()=>fotoWorker.ultimo.id);
  await upload();
  await page.waitForFunction(id=>fotoWorker.ultimo.id!==id,viejo);
  await page.evaluate(id=>fotoWorker.resultado('Luminaria',id),viejo);
  assert.equal(await page.locator('.cat-pick.activo').getAttribute('data-categoria'),'Bache');
  await page.evaluate(()=>fotoWorker.resultado(null));
  assert.match(await page.locator('#foto-analisis').textContent(),/No pude identificar/);
  await upload();
  await page.evaluate(()=>fotoWorker.onerror());
  assert.match(await page.locator('#foto-analisis').textContent(),/No se pudo analizar/);
  await page.locator('#reintentar-analisis').click();
  await page.evaluate(()=>fotoWorker.resultado('Basura'));
  assert.equal(await page.locator('.cat-pick.activo').getAttribute('data-categoria'),'Basura');
  await page.locator('[data-categoria="Fuga"]').click();
  await page.locator('#lat').evaluate(e=>e.value='-15.84');
  await page.locator('#lng').evaluate(e=>e.value='-70.02');
  await page.locator('#descripcion').fill('Prueba de fuga de agua en la calle.');
  await Promise.all([page.waitForURL('**/reporte/**'),page.locator('button[type=submit]').click()]);
  assert.match(await page.locator('h1').textContent(),/Fuga/);
  console.log('OK: sugerencia, cambio manual, respuesta tardia, reemplazo de foto, abstencion, fallo y guardado de la categoria corregida.');
  await context.close();
  if (process.env.SKIP_REAL_MODEL === '1') return;
  // Prueba real de descarga e inferencia, sin simular el modelo.
  const real=await browser.newContext({ignoreHTTPSErrors:true});
  const actual=await real.newPage();
  await actual.goto(process.env.MOBILE_TEST_URL+'/ingresar');
  actual.on('console',m=>console.log(m.text()));
  const resultado=await actual.evaluate(async()=>{
   const blob=await (await fetch('/static/img/logo.png')).blob();
   const imagen=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)});
   return new Promise((resolve,reject)=>{
    const worker=new Worker('/static/js/foto-worker.js',{type:'module'});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('Modelo: tiempo agotado'))},300000);
    let aviso=false;
    worker.onmessage=({data})=>{if(data.tipo==='progreso'){if(!aviso){console.log(data.mensaje);aviso=true}return;}clearTimeout(timer);worker.terminate();resolve(data)};
    worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message))};
    worker.postMessage({id:1,imagen});
   });
  });
  assert.equal(resultado.tipo,'resultado',JSON.stringify(resultado));
  assert.equal(resultado.categoria,null,'Un logo no debe clasificarse como incidencia');
  console.log('OK: modelo real descargado y ejecutado; logo rechazado como incidencia.');
  await real.close();
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
