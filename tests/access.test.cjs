const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function service(storage = new Map()) {
  const context = vm.createContext({ URLSearchParams, sessionStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } });
  vm.runInContext(read("js/auth-service.js"), context);
  return { auth: context.PunoAuth, storage };
}

test("La sesión simulada persiste solo como bandera y se restaura al volver a la portada", async () => {
  const { auth, storage } = service();
  assert.equal(await auth.getSession(), null);
  const restored = service(storage).auth;
  assert.equal((await auth.signIn()).isAuthenticated, true);
  assert.equal((await restored.getSession()).isAuthenticated, true);
  assert.deepEqual([...storage], [["puno-reporta-demo-session", "true"]]);
  storage.clear();
  assert.equal(await restored.getSession(), null);
  assert.equal((await auth.signUp()).isAuthenticated, true);
});

test("Reportar abre el modal sin sesión y va directamente al reporte con sesión", async () => {
  let listener;
  let active = false;
  const destinations = [];
  const dialog = { open: false, opens: 0, showModal() { this.open = true; this.opens++; } };
  vm.runInNewContext(read("js/app.js"), {
    document: { querySelector: () => dialog, querySelectorAll: () => [{ addEventListener: (_, fn) => { listener = fn; } }] },
    PunoAuth: { getSession: async () => active ? { isAuthenticated: true } : null },
    window: { location: { assign: (destination) => destinations.push(destination) } },
  });
  await listener();
  await listener();
  assert.equal(dialog.opens, 1);
  assert.equal(destinations.length, 0);
  dialog.open = false;
  active = true;
  await listener();
  assert.deepEqual(destinations, ["nueva-incidencia.html"]);
});

function formSetup(mode, search, valid = true) {
  const elements = new Map();
  const events = {};
  const destinations = [];
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, {
      dataset: { mode }, value: "password-local", textContent: "", attrs: {}, disabled: false,
      addEventListener(name, callback) { this[name] = callback; },
      setAttribute(name, value) { this.attrs[name] = value; },
      removeAttribute(name) { delete this.attrs[name]; },
      reportValidity() { return valid; },
    });
    return elements.get(id);
  };
  const { auth, storage } = service();
  vm.runInNewContext(read("js/auth.js"), {
    PunoAuth: auth,
    document: { getElementById: el },
    window: { location: { search, assign: (url) => destinations.push(url) }, addEventListener: (name, callback) => { events[name] = callback; } },
  });
  return { el, storage, destinations, events, submit: () => el("auth-form").submit({ preventDefault() {} }) };
}

test("Login y registro llevan al dashboard incluso desde Reportar", async () => {
  for (const mode of ["login", "register"]) {
    const form = formSetup(mode, "?next=reporte");
    assert.equal(form.el("auth-switch").href, (mode === "login" ? "crear-cuenta.html" : "iniciar-sesion.html"));
    await form.submit();
    assert.deepEqual(form.destinations, ["nueva-incidencia.html#inicio"]);
    assert.equal(form.el("password").value, "");
    assert.equal(form.storage.size, 1);
  }
});

test("El acceso directo abre el dashboard y no admite redirecciones externas", async () => {
  for (const search of ["", "?next=https://example.com", "?next=//example.com"]) {
    const form = formSetup("login", search);
    await form.submit();
    assert.deepEqual(form.destinations, ["nueva-incidencia.html#inicio"]);
  }
});

test("Formulario inválido no inicia sesión y las contraseñas se limpian al salir", async () => {
  const form = formSetup("register", "?next=reporte", false);
  await form.submit();
  assert.equal(form.storage.size, 0);
  assert.equal(form.destinations.length, 0);
  form.events.pagehide();
  assert.equal(form.el("password").value, "");
});

test("El modal solo ofrece login, registro y cierre; el login de portada es directo", () => {
  const html = read("index.html");
  const modal = html.match(/<dialog[\s\S]*?<\/dialog>/)[0];
  assert.equal((modal.match(/<button\b/g) || []).length, 1);
  assert.equal((modal.match(/<a\b/g) || []).length, 2);
  assert.match(modal, /iniciar-sesion\.html\?next=reporte/);
  assert.match(modal, /crear-cuenta\.html\?next=reporte/);
  assert.match(html, /header-login" href="iniciar-sesion\.html"/);
  assert.doesNotMatch(html, /Continuar al reporte de prueba|todavía no|En desarrollo|sin autenticarte/);
});
