const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(require.resolve('playwright', {paths: [process.env.NODE_PATH || 'C:/Users/ademi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
(async () => {
  const url = fs.readFileSync(path.join(__dirname, '../ENLACE_MOVIL.txt'), 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)[0];
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, permissions: ['geolocation'], geolocation: {latitude: -15.8402, longitude: -70.0219}});
    const page = await context.newPage();
    const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
    assert.equal(response.status(), 200);
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    const lat = await page.evaluate(() => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(p => resolve(p.coords.latitude), reject)));
    assert.equal(lat, -15.8402);
    assert.equal((await context.request.get(url + '/api/reportes')).status(), 401);
    assert.equal((await context.request.get(url + '/static/uploads/fotos/test.png')).status(), 401);
    console.log('OK: enlace publico con certificado reconocido, contexto seguro, ubicacion simulada y reportes privados.');
    await context.close();
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exit(1)});
