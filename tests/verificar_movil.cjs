const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    // La confianza TLS se comprueba sin excepciones en verificar_movil.py.
    const context = await browser.newContext({ignoreHTTPSErrors: true, permissions: ['geolocation'], geolocation: {latitude: -15.8402, longitude: -70.0219, accuracy: 10}});
    const page = await context.newPage();
    const url = process.env.MOBILE_TEST_URL;
    for (const width of [320, 360, 390, 430, 768]) {
      await page.setViewportSize({width, height: 844});
      await page.goto(url, {waitUntil: 'networkidle'});
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.topbar').getBoundingClientRect();
        const copy = document.querySelector('.landing-copy').getBoundingClientRect();
        return {overflow: document.documentElement.scrollWidth > innerWidth, overlap: header.bottom > copy.top, buttons: [...document.querySelectorAll('.hero-actions .btn')].map(e => e.getBoundingClientRect().width)};
      });
      assert.equal(layout.overflow, false, `Overflow landing ${width}`);
      assert.equal(layout.overlap, false, `Menu sobre titulo ${width}`);
      assert.equal(layout.buttons[0], layout.buttons[1]);
      if (width === 390) await page.screenshot({path: path.join(__dirname, 'movil-inicio.png'), fullPage: true});
    }
    await page.setViewportSize({width: 1366, height: 900});
    await page.goto(url, {waitUntil: 'networkidle'});
    const snapshot = () => page.evaluate(() => [...document.querySelectorAll('.topbar, .topbar nav, .landing-copy, .landing-cats, .hero-actions, .hero-actions .btn')].map(e => {const c=getComputedStyle(e); return [c.display,c.position,c.padding,c.width,c.height,c.gap,c.gridTemplateColumns,c.fontSize,c.color,c.backgroundColor]}));
    const desktop = await snapshot();
    const css = fs.readFileSync(path.join(__dirname, '../static/css/style.css'), 'utf8').split('/* Ajustes exclusivos')[0];
    await page.evaluate(css => {document.querySelector('link[href*="css/style.css"]').disabled=true; const s=document.createElement('style');s.textContent=css;document.head.appendChild(s)}, css);
    assert.deepEqual(await snapshot(), desktop, 'El escritorio debe conservar su distribucion');
    await context.addCookies([{name: 'session', value: process.env.MOBILE_TEST_COOKIE, url}]);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({width, height: 844});
      await page.goto(url + '/reportar', {waitUntil: 'networkidle'});
      await page.waitForFunction(() => document.querySelector('#lat').value === '-15.840200');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow formulario ${width}`);
      assert.equal(await page.locator('.side-ciudadano').evaluate(e => getComputedStyle(e).position), 'relative');
      if (width === 390) await page.screenshot({path: path.join(__dirname, 'movil-reportar.png'), fullPage: true});
    }
    await context.setGeolocation({latitude: -15.841, longitude: -70.022, accuracy: 8});
    await page.waitForFunction(() => document.querySelector('#lat').value === '-15.841000');
    console.log('OK: 5 anchos moviles, formulario sin desbordamiento, escritorio intacto y GPS simulado en HTTPS.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exit(1)});
