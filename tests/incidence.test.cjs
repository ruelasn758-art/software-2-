const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

// Doble mínimo del DOM para probar permisos y respuestas asíncronas sin usar GPS real.
async function setup({ secure = true, geo = true, leaflet = true, hash = "", storage = new Map(), failWrites = false, categoryFetch = null, postFetch = null, typesFetch = null, uploadFetch = null, reportsFetch = null, aiFetch = null } = {}) {
  const elements = new Map();
  class Element {
    constructor() {
      this.style={};
      this.listeners = {}; this.attrs = {}; this.value = ""; this.textContent = "";
      this.hidden = true; this.disabled = false; this.files = []; this.validity = { valid: true };
      this.selectedOptions = [{ textContent: "Vías" }];
    }
    querySelector(selector) { return (this.queries ||= {})[selector] ||= new Element(); }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    emit(name, extra = {}) { return Promise.all((this.listeners[name] || []).map(fn => fn({ target: this, preventDefault() {}, ...extra }))); }
    click() { return this.emit("click"); }
    focus() { this.focused = true; }
    reset() {}
    replaceChildren(...children) { this.children = children; }
    append(...children) { (this.children ||= []).push(...children); }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    setCustomValidity(message) { this.validationMessage = message; this.validity.valid = !message; }
    reportValidity() { return [...elements.values()].every((el) => el.disabled || el.validity.valid); }
    checkValidity() { return this.reportValidity(); }
    get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); }
  }
  const el = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const posts = [];
  const uploads = [];
  const requests = [], images = [], revoked = [], snapshots = [], windowEvents = {};
  const map = { events: {}, markers: [], center: null,
    setView(point, zoom) { this.center = point; this.zoom = zoom; return this; },
    on(name, callback) { this.events[name] = callback; return this; },
    invalidateSize() {}, removeLayer(marker) { this.markers = this.markers.filter(item => item !== marker); },
    remove() { this.markers = []; this.events = {}; }, getCenter() { return { lat: this.center[0], lng: this.center[1] }; },
  };
  const tileEvents = {};
  const L = {
    map() { return map; },
    tileLayer() { return { addTo() { return this; }, on(name, callback) { tileEvents[name] = callback; return this; } }; },
    marker(point) { return { point, addTo(target) { target.markers.push(this); return this; }, setLatLng(value) { this.point = value; return this; } }; },
  };
  const context = vm.createContext({
    PunoAuth:{current:{usuario:{id_usuario:'1',rol:'CIUDADANO',nombre:'Prueba'}},async requireSession(){return this.current;},async logout(){}},
    L: leaflet ? L : undefined,
    console: { log() {} },
    FormData: class { constructor() { this.fields = new Map(); } append(key, value) { this.fields.set(key, value); } get(key) { return this.fields.get(key); } },
    fetch: async (url, options) => {
      if(url.includes("/entidad/")) {
        const areaId=url.includes("/limpieza/")?"2":"1",name=areaId==="2"?"Área de Limpieza":"Área de Vías";
        const store=context.ReportStore;
        const record=url.match(/reportes\/([^/]+)\//)?.[1];
        if(record) {
          const report=store.reports.find(r=>String(r.id_reporte)===record&&String(r.id_area_responsable)===areaId);
          if(!report)return {ok:false,json:async()=>({message:"Reporte de otra área"})};
          try {
            await store.updateReport(report.id,url.endsWith("/solucion")?{status:"Solucionado",solutionPhoto:options.body.get("archivo"),solutionNote:options.body.get("observacion")}:{status:JSON.parse(options.body).estado});
            return {ok:true,json:async()=>({ok:true})};
          }catch(e){return {ok:false,json:async()=>({message:e.message})};}
        }
        return {ok:true,json:async()=>({area:{id_area:areaId,area:name},reportes:store.reports.filter(r=>String(r.id_area_responsable)===areaId).map(r=>({
          id_reporte:r.id_reporte,codigo:r.code,id_usuario:"1",id_area_responsable:areaId,area_responsable:r.entity,
          categoria:r.categoryLabel,id_categoria:r.id_categoria,tipo_incidencia:r.typeLabel,id_tipo_incidencia:r.id_tipo_incidencia,
          descripcion:r.description,estado:r.status,fecha_registro:r.createdAt,latitud:r.location.latitude,longitud:r.location.longitude,
          archivos:r.solutionPhoto?[{tipo_archivo:"SOLUCION",ruta_archivo:"/uploads/soluciones/mock.png",descripcion:r.solutionNote,fecha_registro:r.solvedAt}]:[],historial:[]
        }))})};
      }
      if (url.includes("/ia/estado")) return {ok:true,json:async()=>({disponible:false})};
      if (url.includes("/ia/analizar")) return aiFetch ? aiFetch(url, options) : {ok:false,json:async()=>({ok:false})};
      if (url.includes("/destinos")) return {ok:true,json:async()=>({destinos:["Área de Vías","Área de Limpieza","Área responsable de alumbrado","Área responsable de agua y saneamiento"].map((area,i)=>({id_area:String(i+1),entidad:"Entidad de prueba",area,descripcion:"Descripción del área"})),id_area_recomendada:url.match(/categoria=(\d+)/)?.[1] || null})};
      if (url.endsWith("/reportes") && !options?.body) {
        if (reportsFetch) return reportsFetch(url);
        throw new Error("offline: pruebas del respaldo local");
      }
      if (url.endsWith("/archivos")) {
        uploads.push({ url, options });
        return uploadFetch ? uploadFetch(url, options) : { ok: true, json: async () => ({ ok: true, archivo: { id_archivo: 1, ruta_archivo: "/uploads/incidencias/test.png" } }) };
      }
      if (url.includes("tipos-incidencia")) return typesFetch ? typesFetch(url) : { ok: true, json: async () => [{ id_tipo_incidencia: "11", nombre: "Problema de prueba" }] };
      if (url.endsWith("/reportes")) {
        posts.push(JSON.parse(options.body));
        return postFetch ? postFetch(url, options) : { ok: true, json: async () => ({ ok: true, reporte: { id_reporte: posts.length, codigo: "PR-" + String(posts.length).padStart(5, "0"), estado: "Reportado", id_area_responsable: String(posts.at(-1).id_area_destino||posts.at(-1).id_categoria) } }) };
      }
      return categoryFetch ? categoryFetch(url) : { ok: true, json: async () => ["Vías", "Limpieza", "Alumbrado", "Agua / Saneamiento"].map((nombre, index) => ({ id_categoria: String(index + 1), nombre })) };
    }, AbortSignal,
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { if (failWrites) throw new Error("QuotaExceededError"); storage.set(key, value); } },
    FileReader: class { readAsDataURL(file) { this.result = "data:" + file.type + ";base64,Zm90bw=="; this.onload(); } },
    document: { body:{style:{}},querySelector:el,getElementById: el, createElement() { return new Element(); } },
    navigator: geo ? { geolocation: { getCurrentPosition(success, failure, options) { requests.push({ success, failure, options }); } } } : {},
    window: { isSecureContext: secure, addEventListener(name, fn) { windowEvents[name] = fn; }, location: { hash, reload() {} } },
    URL: { createObjectURL() { return `blob:photo-${images.length}`; }, revokeObjectURL(url) { revoked.push(url); } },
    Image: class { constructor() { images.push(this); } },
  });
  vm.runInContext(fs.readFileSync(path.join(root, "js/category-routing.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/incidence-data.js"), "utf8"), context);
  const data = context.IncidenceData;
  context.IncidenceData = { coordinates: data.coordinates, snapshot(input) { const result = data.snapshot(input); snapshots.push(result); return result; } };
  vm.runInContext(fs.readFileSync(path.join(root, "js/report-location.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/report-detail.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/citizen-dashboard.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/report-store.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/entity-reports.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/entity-dashboard.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/report-assistance.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/my-reports.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/incidence-map.js"), "utf8"), context);
  await vm.runInContext(fs.readFileSync(path.join(root, "js/new-incidence.js"), "utf8"), context);
  await context.window.PunoCategories.loadCategories();
  return { uploads, posts, el, requests, images, revoked, snapshots, data, windowEvents, map, tileEvents, context, storage, categories: context.window.PunoCategories };
}
async function entitySession(s,key) {
  Object.assign(s.context.PunoAuth.current.usuario,{rol:'ENTIDAD',area_key:key,area_responsable:key==='vias'?'Área de Vías':'Área de Limpieza'});
  s.context.window.location.hash='#entidad-'+key;
  await s.windowEvents.hashchange();
}
const position = (latitude, longitude, accuracy = 12) => ({ coords: { latitude, longitude, accuracy } });

test("Corrección por selector conserva tipo opcional y envía el destino elegido", async () => {
  const s=await setup();
  s.el("category").value="limpieza";await s.el("category").emit("change");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.categories.getSelected().id_categoria,"2");
  assert.equal(s.el("destination").value,"2");
  s.el("destination").value="1";await s.el("destination").emit("change");
  addPhoto(s);confirmManual(s);
  await s.el("incidence-form").emit("submit");
  assert.equal(s.posts[0].id_categoria,"2");
  assert.equal(s.posts[0].id_tipo_incidencia,null);
  assert.equal(s.posts[0].id_area_destino,"1");
  assert.equal(s.uploads.length,1);
  assert.equal(s.el("report-confirmation").hidden,false);
});

test("Mapa filtra fechas y categorías sin alterar datos ni aceptar coordenadas inválidas", async () => {
  const s=await setup(),map=s.context.IncidenceMap;
  const now=Date.parse("2026-10-31T12:00:00Z");
  const rows=[{status:"Reportado",categoryLabel:"Vías",createdAt:"2026-10-30T12:00:00Z",location:{latitude:-15.84,longitude:-70.02}},
    {status:"Solucionado",categoryLabel:"Agua",createdAt:"2026-09-01T12:00:00Z",location:{latitude:null,longitude:0}},
    {status:"En proceso",categoryLabel:"Vías",createdAt:"2026-10-20T12:00:00Z",location:{latitude:95,longitude:0}}];
  assert.equal(map.filter(rows,{period:"7",now}).length,1);
  assert.equal(map.filter(rows,{period:"30",state:"En proceso",category:"Vías",now}).length,1);
  assert.equal(map.filter(rows,{category:"Limpieza",now}).length,0);
  assert.equal(rows.filter(map.located).length,1);
  assert.equal(map.located({location:{latitude:0,longitude:0}}),true);
  assert.equal(rows.length,3);
  let centered;
  map.prototype.center.call({points:[rows[0]],map:{invalidateSize(){},fitBounds(points,options){centered={points,options};}}});
  assert.equal(centered.points.length,1);
  assert.equal(centered.points[0][0],-15.84);
  assert.equal(centered.points[0][1],-70.02);
  assert.equal(centered.options.animate,false);
});

test("Mis reportes: búsqueda, filtros combinados, paginación y totales independientes", async () => {
  const s=await setup();let opened;
  const panel=new s.context.MyReports({byId:s.el,openDetail:r=>{opened=r;}});
  const rows=Array.from({length:12},(_,i)=>({code:`PR-${i}`,description:i===4?"Luminaria apagada":"Bache",entity:"Área de prueba",categoryLabel:i%2?"Vías":"Alumbrado",status:i<6?"Reportado":"Solucionado",createdAt:new Date(2026,0,i+1).toISOString(),location:{latitude:-15.84,longitude:-70.02}}));
  panel.setReports(rows);
  assert.equal(s.el("temporary-report-list").children.length,5);
  assert.equal(s.el("reports-count-total").textContent,"12");
  await s.el("reports-next").click();assert.equal(panel.page,2);
  await s.el("reports-next").click();assert.equal(s.el("temporary-report-list").children.length,2);
  s.el("reports-search").value="luminaria";await s.el("reports-search").emit("input");
  assert.equal(panel.page,1);assert.equal(s.el("temporary-report-list").children.length,1);
  await s.el("temporary-report-list").children[0].children[3].click();assert.equal(opened.code,"PR-4");
  s.el("reports-state").value="Solucionado";await s.el("reports-state").emit("change");assert.equal(s.el("reports-empty").hidden,false);
  assert.equal(s.el("reports-count-total").textContent,"12");
  await s.el("reports-clear").click();
  s.el("reports-order").value="oldest";await s.el("reports-order").emit("change");assert.equal(s.el("temporary-report-list").children[0].children[0].textContent,"PR-0");
  s.el("reports-category").value="Vías";await s.el("reports-category").emit("change");assert.equal(s.el("temporary-report-list").children[0].children[0].textContent,"PR-1");
  assert.equal(rows[0].code,"PR-0");
});

test("Formulario único permite tipo vacío incluso si falla su carga y conserva dashboards", async () => {
  for (const typesFetch of [null, async () => { throw new Error("offline"); }, async () => ({ ok: true, json: async () => [] })]) {
    const s = await setup({ typesFetch });
    await s.el("choose-vias").click();
    assert.equal(s.el("next-step").disabled, false);
    assert.equal(s.el("incidence-type").value, "");
    addPhoto(s); confirmManual(s);
    for (let i = 0; i < 3; i++) await s.el("next-step").click();
    await s.el("incidence-form").emit("submit");
    assert.equal(s.posts[0].id_tipo_incidencia, null);
    assert.equal(s.el("report-confirmation").hidden, false);
    const saved = s.context.ReportStore.reports[0];
    assert.equal(saved.id_tipo_incidencia, null);
    await s.el("citizen-home").click();
    assert.equal(s.el("dashboard-total").textContent, "1");
    await s.el("view-my-reports").click();
    assert.equal(s.el("temporary-report-list").children.length, 1);
    await s.el("citizen-home").click();
    await s.el("dashboard-recent").children[0].children.at(-1).click();
    assert.equal(s.el("detail-code").textContent, saved.code);
    await entitySession(s,"vias");
    assert.equal(s.el("entity-total").textContent, "1");
    await s.el("entity-report-list").children[0].children[4].click();
    assert.equal(s.el("entity-detail-code").textContent, saved.code);
    const reloaded = await setup({ storage: s.storage });
    assert.equal(reloaded.context.ReportStore.reports[0].id_tipo_incidencia, null);
  }
});

test("Se puede retirar el tipo y cambiar categoría sin conservar selecciones antiguas", async () => {
  const s = await setup(); await chooseCategory(s, "vias");
  s.el("incidence-type").value = ""; await s.el("incidence-type").emit("change");
  assert.equal(s.el("next-step").disabled, false);
  await chooseCategory(s, "vias"); await s.el("choose-limpieza").click();
  assert.equal(s.el("incidence-type").value, "");
  assert.equal(s.categories.getSelectedType(), null);
  assert.equal(s.el("next-step").disabled, false);
});

test("Fallo de foto conserva el reporte creado y reintenta solo multipart sin éxito falso", async () => {
  let attempts = 0;
  const s = await setup({ uploadFetch: async () => {
    if (++attempts === 1) throw new TypeError("offline");
    return { ok: true, json: async () => ({ ok: true, archivo: { ruta_archivo: "/uploads/incidencias/test.png" } }) };
  } });
  await prepareRequired(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  assert.equal(s.el("report-confirmation").hidden, true);
  assert.equal(s.context.ReportStore.reports.length, 0);
  assert.match(s.el("report-message").textContent, /PR-00001/);
  assert.equal(s.el("send-report").textContent, "Reintentar subir foto");
  await s.el("incidence-form").emit("submit");
  assert.equal(s.posts.length, 1);
  assert.equal(s.uploads.length, 2);
  assert.equal(s.uploads[0].options.body.get("tipo_archivo"), "INCIDENCIA");
  assert.equal(s.uploads[0].options.body.get("archivo").name, "incidente.png");
  assert.equal(s.uploads[0].options.headers, undefined);
  assert.equal(s.el("report-confirmation").hidden, false);
  assert.equal(s.context.ReportStore.reports[0].archivo.ruta_archivo, "/uploads/incidencias/test.png");
});

test("POST envía solo los campos permitidos y conserva el id y código del backend", async () => {
  const s = await setup();
  await prepareRequired(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  const payload = s.posts[0];
  assert.deepEqual(Object.keys(payload).sort(), ["id_usuario", "id_categoria", "id_tipo_incidencia", "descripcion", "latitud", "longitud", "origen_ubicacion", "precision_metros", "id_area_destino"].sort());
  assert.equal(payload.id_usuario, "1");
  assert.equal(payload.id_categoria, "1");
  assert.equal(payload.id_tipo_incidencia, "11");
  assert.equal(payload.origen_ubicacion, "MANUAL");
  assert.equal(payload.precision_metros, null);
  assert.equal(payload.latitud, -15.84);
  assert.equal(s.context.ReportStore.reports[0].id_reporte, 1);
  assert.equal(s.el("confirmation-code").textContent, "PR-00001");
  await s.el("incidence-form").emit("submit");
  assert.equal(s.posts.length, 1);
});

test("Error API conserva formulario, foto y ubicación sin éxito ni respaldo ficticio", async () => {
  for (const postFetch of [async () => { throw new TypeError("offline"); }, async () => ({ ok: false, json: async () => ({ ok: false, message: "Tipo no válido" }) })]) {
    const s = await setup({ postFetch });
    await prepareRequired(s); confirmManual(s);
    s.el("description").value = "Conservar esta descripción";
    for (let i = 0; i < 3; i++) s.el("next-step").click();
    await s.el("incidence-form").emit("submit");
    assert.equal(s.el("report-confirmation").hidden, true);
    assert.equal(s.context.ReportStore.reports.length, 0);
    assert.equal(s.el("description").value, "Conservar esta descripción");
    assert.equal(s.el("photo-preview").hidden, false);
    assert.equal(s.el("location-required").hidden, true);
    assert.ok(s.el("report-message").textContent);
    assert.equal(s.el("report-fields").disabled, false);
  }
});

test("Cambiar categoría descarta tipos anteriores y respuestas tardías", async () => {
  const pending = [];
  const s = await setup({ typesFetch: url => new Promise(resolve => pending.push({ url, resolve })) });
  const first = s.el("choose-vias").click();
  const second = s.el("choose-limpieza").click();
  pending[1].resolve({ ok: true, json: async () => [{ id_tipo_incidencia: "25", nombre: "Residuos" }] });
  await second;
  pending[0].resolve({ ok: true, json: async () => [{ id_tipo_incidencia: "11", nombre: "Bache" }] });
  await first;
  s.el("incidence-type").value = "11"; await s.el("incidence-type").emit("change");
  assert.equal(s.el("next-step").disabled, true);
  s.el("incidence-type").value = "25"; await s.el("incidence-type").emit("change");
  assert.equal(s.el("next-step").disabled, false);
  assert.equal(s.categories.getSelectedType().nombre, "Residuos");
});

test("Categorías API conservan IDs reales y nombres sin cambiar claves ni eventos", async () => {
  const rows = [
    { id_categoria: 18, nombre: "Vías" }, { id_categoria: 4, nombre: "Limpieza" },
    { id_categoria: 32, nombre: "Alumbrado" }, { id_categoria: "9", nombre: "Agua / Saneamiento" },
  ];
  const s = await setup({ categoryFetch: async url => {
    assert.equal(url, "http://127.0.0.1:3001/api/categorias");
    return { ok: true, json: async () => rows };
  } });
  await s.categories.loadCategories();
  assert.equal(s.categories.getSource(), "api");
  await chooseCategory(s, "agua");
  assert.equal(s.el("category").value, "agua");
  assert.equal(s.categories.getSelected().id_categoria, "9");
  assert.equal(s.categories.getSelected().nombre, "Agua / Saneamiento");
  assert.equal(s.el("choose-agua").querySelector("strong").textContent, "Agua / Saneamiento");
  assert.equal(s.el("next-step").disabled, false);
  await chooseCategory(s, "vias");
  assert.equal(s.categories.getSelected().id_categoria, 18);
  const received = s.categories.getReceived(); received[0].nombre = "Alterado";
  assert.equal(s.categories.getReceived()[0].nombre, "Vías");
});

test("Categorías sin backend usan fallback sin inventar IDs; lista vacía API no permite seleccionar", async () => {
  const s = await setup({ categoryFetch: async () => { throw new Error("Offline"); } });
  await s.categories.loadCategories();
  await chooseCategory(s, "vias");
  assert.equal(s.categories.getSource(), "fallback");
  assert.equal(s.categories.getSelected().id_categoria, null);
  assert.equal(s.el("next-step").disabled, true);
  const empty = await setup({ categoryFetch: async () => ({ ok: true, json: async () => [] }) });
  await empty.categories.loadCategories();
  empty.el("choose-vias").click();
  assert.equal(empty.el("choose-vias").hidden, true);
  assert.equal(empty.el("next-step").disabled, true);
});

test("Limpieza reutiliza la gestión y persiste la solución sin mostrar reportes de Vías", async () => {
  const s = await setup();
  await entitySession(s,'limpieza');
  assert.equal(s.el("entity-title").textContent, "Área de Limpieza");
  assert.equal(s.el("entity-dashboard").attrs["data-area"], "limpieza");
  assert.equal(s.el("entity-icon-vias").attrs.hidden, "");
  s.context.PunoAuth.current.usuario.rol="CIUDADANO"; await s.el("citizen-home").click();
  s.el("dashboard-create").click();
  await chooseCategory(s, "limpieza"); addPhoto(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  const report = s.context.ReportStore.reports[0];
  assert.equal(report.entity, "Entidad de prueba — Área de Limpieza");
  await entitySession(s,"vias");
  assert.equal(s.el("entity-total").textContent, "0");
  await entitySession(s,"limpieza");
  assert.equal(s.el("entity-total").textContent, "1");
  s.el("entity-report-list").children[0].children[4].click();
  await s.el("entity-start").click();
  s.el("entity-register").click();
  await s.el("entity-solution-form").emit("submit");
  assert.equal(report.status, "En proceso");
  s.el("entity-photo-file").files = [{ type: "image/png" }];
  s.el("entity-photo-file").emit("change"); s.images.at(-1).onload();
  s.el("entity-solution-note").value = "Residuos retirados";
  await s.el("entity-solution-form").emit("submit");
  assert.equal(report.status, "Solucionado");
  assert.equal(report.solutionNote, "Residuos retirados");
  const restored = await setup({ storage: s.storage, hash: "#inicio" });
  assert.equal(restored.el("dashboard-solved").textContent, "1");
  await restored.el("dashboard-view-all").click();
  restored.el("temporary-report-list").children[0].children[3].click();
  assert.equal(restored.el("detail-solution-note").textContent, "Residuos retirados");
});

test("Filtro configurable reconoce nombres anteriores y rechaza categorías ajenas", async () => {
  const s = await setup();
  const cleaning = new s.context.EntityReports([], s.context.EntityAreas.limpieza);
  assert.equal(cleaning.belongs({ category: "limpieza", entity: "Área responsable de limpieza" }), true);
  assert.equal(cleaning.belongs({ entity: "Área responsable de limpieza" }), true);
  for (const category of ["vias", "alumbrado", "agua"]) {
    assert.equal(cleaning.belongs({ category, entity: "Área de Limpieza" }), false);
  }
  assert.deepEqual(Object.keys(s.context.EntityAreas), ["vias", "limpieza"]);
});

test("Flujo persistente: crear, recargar, atender, solucionar y ver evidencia como ciudadano", async () => {
  const s = await setup();
  await prepareRequired(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  const report = s.context.ReportStore.reports[0];
  assert.equal(s.el("confirmation-code").textContent, report.code);
  assert.equal(s.el("confirmation-entity").textContent, "Entidad de prueba — Área de Vías");
  assert.match(report.photo, /^data:image/);
  const restored = await setup({ storage: s.storage, hash: "#entidad-vias" });
  const same = restored.context.ReportStore.reports[0];
  assert.equal(same.id, report.id);
  const entity = new restored.context.EntityReports(restored.context.ReportStore.reports);
  await entity.transition(same.code, "En proceso");
  assert.equal(restored.context.ReportStore.getReportById(same.id), same);
  await entity.transition(same.code, "Solucionado", { photoConfirmed: true, photo: { type: "image/png" }, note: "Vía reparada" });
  assert.equal(restored.context.ReportStore.getReportById(same.id), same);
  const citizen = await setup({ storage: s.storage, hash: "#inicio" });
  assert.equal(citizen.el("dashboard-solved").textContent, "1");
  await citizen.el("dashboard-view-all").click();
  citizen.el("temporary-report-list").children[0].children[3].click();
  assert.equal(citizen.el("detail-status").textContent, "Solucionado");
  assert.equal(citizen.el("detail-solution").hidden, false);
  assert.equal(citizen.el("detail-solution-note").textContent, "Vía reparada");
  assert.match(citizen.el("detail-solution-photo").src, /^data:image/);
  assert.equal(citizen.el("detail-progress-2").attrs["data-active"], "true");
  assert.equal(citizen.context.ReportStore.reports.length, 1);
});

test("Fallo del respaldo local no oculta el registro exitoso en PostgreSQL", async () => {
  const s = await setup({ failWrites: true });
  await prepareRequired(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  assert.equal(s.posts.length, 1);
  assert.equal(s.el("report-confirmation").hidden, false);
  assert.match(s.el("confirmation-warning").textContent, /no se pudo guardar/);
});

test("Cambio guardado en otra pestaña refresca el dashboard sin duplicar el objeto", async () => {
  const s = await setup();
  await prepareRequired(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  const original = s.context.ReportStore.reports[0];
  await s.el("citizen-home").click();
  const other = await setup({ storage: s.storage });
  await other.context.ReportStore.updateReport(original.id, { status: "En proceso" });
  await s.windowEvents.storage({ key: "puno-reporta-reports-user-1" });
  assert.equal(s.context.ReportStore.reports[0], original);
  assert.equal(s.el("dashboard-progress").textContent, "1");
  assert.equal(s.el("dashboard-reported").textContent, "0");
  const blocked = await setup({ storage: s.storage, failWrites: true });
  await assert.rejects(() => blocked.context.ReportStore.updateReport(original.id, {
    status: "Solucionado", solutionPhoto: { type: "image/png" },
  }), /No se pudo guardar/);
  assert.equal(blocked.context.ReportStore.reports[0].status, "En proceso");
});

test("Evidencia corrupta o respuesta tardía no habilita el cierre de otro reporte", async () => {
  const s = await setup();
  await prepareRequired(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  await entitySession(s,"vias");
  s.el("entity-report-list").children[0].children[4].click();
  await s.el("entity-start").click();
  s.el("entity-register").click();
  s.el("entity-photo-file").files = [{ type: "image/png" }];
  s.el("entity-photo-file").emit("change");
  s.images.at(-1).onerror();
  assert.equal(s.el("entity-solve").disabled, true);
  s.el("entity-photo-file").emit("change");
  const pending = s.images.at(-1);
  await s.el("entity-nav-home").click();
  pending.onload();
  assert.equal(s.el("entity-solve").disabled, true);
  assert.equal(s.el("entity-preview").hidden, true);
});

test("Área de Vías filtra categorías y protege transiciones y campos originales", async () => {
  const s = await setup();
  const reports = ["vias", "limpieza", "alumbrado", "agua"].map((category, index) => ({
    id: String(index), code: String(index), category, status: "Reportado", photo: { type: "image/png" }, location: { latitude: -15.8, longitude: -70 },
    entity: category === "vias" ? "Área de Vías" : "Otra área",
  }));
  s.context.ReportStore.reports.push(...reports);
  const store = new s.context.EntityReports(s.context.ReportStore.reports);
  assert.equal(store.list().length, 1);
  await assert.rejects(() => store.transition("1", "En proceso"), /no corresponde/);
  await assert.rejects(() => store.transition("0", "Solucionado"), /No se permite/);
  const original = reports[0];
  await store.transition("0", "En proceso");
  assert.equal(reports[0].status, "En proceso");
  await assert.rejects(() => store.transition("0", "Solucionado"), /fotografía/);
  const photo = { type: "image/jpeg" };
  await store.transition("0", "Solucionado", { photo, photoConfirmed: true, note: "  Reparado  " });
  assert.equal(reports[0].photo, original.photo);
  assert.equal(reports[0].location, original.location);
  assert.equal(reports[0].category, original.category);
  assert.match(reports[0].solutionPhoto, /^data:image\/jpeg/);
  assert.equal(reports[0].solutionNote, "Reparado");
  assert.ok(Number.isFinite(Date.parse(reports[0].solvedAt)));
  assert.equal(store.find("0"), original);
  await assert.rejects(() => store.transition("0", "En proceso"), /No se permite/);
});

test("Entidad registra evidencia válida y el ciudadano ve el cambio sobre la misma fuente", async () => {
  const s = await setup();
  await prepareRequired(s); confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  await entitySession(s,"vias");
  assert.equal(s.el("entity-dashboard").hidden, false);
  assert.equal(s.el("entity-total").textContent, "1");
  s.el("entity-report-list").children[0].children[4].click();
  assert.equal(s.el("entity-start").hidden, false);
  await s.el("entity-solution-form").emit("submit");
  assert.equal(s.el("entity-detail-status").textContent, "Reportado");
  await s.el("entity-start").click();
  assert.equal(s.el("entity-detail-status").textContent, "En proceso");
  assert.equal(s.el("entity-solution-form").hidden, false);
  assert.equal(s.el("entity-register").hidden, true);
  assert.equal(s.el("entity-solve").textContent, "Registrar solución");
  s.el("entity-register").click();
  assert.equal(s.el("entity-solution-form").hidden, false);
  await s.el("entity-solution-form").emit("submit");
  assert.equal(s.el("entity-detail-status").textContent, "En proceso");
  s.el("entity-photo-file").files = [{ type: "image/jpeg", name: "solucion.jpg" }];
  s.el("entity-photo-file").emit("change");
  assert.equal(s.el("entity-solve").disabled, true);
  s.images.at(-1).onload();
  assert.equal(s.el("entity-solve").disabled, false);
  await s.el("entity-solution-form").emit("submit");
  assert.equal(s.el("entity-detail-status").textContent, "Solucionado");
  assert.equal(s.el("entity-solved").hidden, false);
  assert.equal(s.el("entity-solved-note").hidden, true);
  assert.equal(s.el("entity-start").hidden, true);
  assert.equal(s.el("entity-register").hidden, true);
  await s.el("entity-nav-solved").click();
  assert.equal(s.el("entity-solved-count").textContent, "1");
  s.context.PunoAuth.current.usuario.rol="CIUDADANO"; await s.el("citizen-home").click();
  assert.equal(s.el("dashboard-solved").textContent, "1");
  assert.equal(s.el("dashboard-reported").textContent, "0");
  assert.equal(s.requests.length, 0);
});

test("Dashboard cuenta todos los estados y ordena hasta cinco más recientes sin mutar los datos", async () => {
  const s = await setup();
  let selected;
  const dashboard = new s.context.CitizenDashboard({ byId: s.el, openDetail(report) { selected = report; } });
  const reports = [
    { code: "1", status: "Solucionado", createdAt: "2026-10-11T12:00:00Z" },
    { code: "2", status: "Reportado", createdAt: "2026-10-14T12:00:00Z" },
    { code: "3", status: "En proceso", createdAt: "2026-10-13T12:00:00Z" },
    { code: "4", status: "Reportado", createdAt: "2026-10-12T12:00:00Z" },
  ].map(report => Object.freeze({ ...report, categoryLabel: "Vías", entity: "Área de Vías", photo: { type: "image/png" } }));
  Object.freeze(reports);
  dashboard.render(reports);
  assert.equal(s.el("dashboard-total").textContent, "4");
  assert.equal(s.el("dashboard-reported").textContent, "2");
  assert.equal(s.el("dashboard-progress").textContent, "1");
  assert.equal(s.el("dashboard-solved").textContent, "1");
  const rows = s.el("dashboard-recent").children;
  assert.deepEqual(rows.map(row => row.children[1].children[0].textContent), ["2", "3", "4", "1"]);
  rows[1].children[4].click();
  assert.equal(selected, reports[2]);
  dashboard.render([]);
  assert.equal(s.el("dashboard-total").textContent, "0");
  assert.equal(s.el("dashboard-empty").hidden, false);
  assert.equal(s.el("dashboard-recent").children.length, 0);
  assert.equal(s.revoked.length, 4);
});

test("Inicio abre el dashboard, conserva borrador y comparte reportes con lista y detalle", async () => {
  const s = await setup({ hash: "#inicio" });
  assert.equal(s.el("citizen-dashboard").hidden, false);
  assert.equal(s.el("incidence-form").hidden, true);
  assert.equal(s.el("dashboard-total").textContent, "0");
  s.el("dashboard-create").click();
  await prepareRequired(s);
  await s.el("citizen-home").click();
  s.el("citizen-report").click();
  assert.equal(s.el("category").value, "vias");
  assert.equal(s.el("photo-preview").hidden, false);
  confirmManual(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  await s.el("citizen-home").click();
  assert.equal(s.el("dashboard-total").textContent, "1");
  s.el("dashboard-recent").children[0].children[4].click();
  assert.equal(s.el("report-detail").hidden, false);
  assert.equal(s.el("detail-code").textContent, "PR-00001");
  await s.el("detail-back").click();
  assert.equal(s.el("my-reports").hidden, false);
  assert.equal(s.el("temporary-report-list").children.length, 1);
  await s.el("citizen-home").click();
  await s.el("dashboard-view-all").click();
  assert.equal(s.el("my-reports").hidden, false);
  assert.equal(s.requests.length, 0);
});

test("Detalle abre el reporte elegido, conserva foto y coordenadas sin solicitar GPS y vuelve a la lista", async () => {
  const s = await setup();
  await prepareRequired(s);
  confirmManual(s, -15.85, -70.03);
  s.el("description").value = "Bache junto a la plaza";
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  await s.el("view-my-reports").click();
  const button = s.el("temporary-report-list").children[0].children[3];
  button.click();
  assert.equal(s.el("report-detail").hidden, false);
  assert.equal(s.el("my-reports").hidden, true);
  assert.equal(s.el("detail-code").textContent, "PR-00001");
  assert.equal(s.el("detail-description").textContent, "Bache junto a la plaza");
  assert.equal(s.el("detail-description-block").hidden, false);
  assert.ok(Number.isFinite(Date.parse(s.el("detail-date").attrs.datetime)));
  assert.match(s.el("detail-photo").src, /^(blob:|data:image)/);
  assert.equal(s.map.center[0], -15.85);
  assert.equal(Number(s.el("detail-longitude").textContent).toFixed(2), "-70.03");
  assert.equal(s.requests.length, 0);
  await s.el("detail-back").click();
  assert.equal(s.el("my-reports").hidden, false);
  assert.equal(s.el("report-detail").hidden, true);
  assert.equal(button.focused, true);
  assert.equal(s.revoked.length, 1);
});

test("Detalle omite descripción vacía y representa los tres estados sin controles de edición", async () => {
  const s = await setup({ leaflet: false });
  const detail = new s.context.ReportDetail(s.el);
  const report = { code: "PR-00001", categoryLabel: "Vías", entity: "Área de Vías", createdAt: "2026-10-14T14:15:00Z", photo: { type: "image/png" }, description: "", location: { latitude: -15.84, longitude: -70.02 } };
  ["Reportado", "En proceso", "Solucionado"].forEach((status, current) => {
    detail.show({ ...report, status });
    for (let index = 0; index < 3; index++) {
      assert.equal(s.el(`detail-progress-${index}`).attrs["data-active"], String(index <= current));
      assert.equal(s.el(`detail-progress-${index}`).attrs["aria-current"], index === current ? "step" : undefined);
    }
  });
  assert.equal(s.el("detail-description-block").hidden, true);
  assert.match(s.el("detail-map-status").textContent, /coordenadas/);
  assert.equal(s.requests.length, 0);
});

test("Confirmación simulada, envío único y nuevo reporte con requisitos reiniciados", async () => {
  const s = await setup();
  const submit = async () => {
    await prepareRequired(s);
    confirmManual(s);
    for (let i = 0; i < 3; i++) s.el("next-step").click();
    assert.equal(s.el("report-review").hidden, false);
    await s.el("incidence-form").emit("submit");
  };
  assert.equal(s.el("report-confirmation").hidden, true);
  await submit();
  assert.equal(s.el("incidence-form").hidden, true);
  assert.equal(s.el("report-confirmation").hidden, false);
  assert.equal(s.el("confirmation-code").textContent, "PR-00001");
  assert.equal(s.el("confirmation-status").textContent, "Reportado");
  assert.equal(s.el("confirmation-title").focused, true);
  await s.el("incidence-form").emit("submit");
  await s.el("view-my-reports").click();
  assert.equal(s.el("my-reports").hidden, false);
  assert.equal(s.el("temporary-report-list").children.length, 1);
  assert.equal(s.el("temporary-report-list").children[0].children[0].textContent, "PR-00001");
  s.el("create-report-from-list").click();
  assert.equal(s.el("incidence-form").hidden, false);
  assert.equal(s.el("step-0").hidden, false);
  assert.equal(s.el("category").value, "");
  assert.equal(s.el("description").value, "");
  assert.equal(s.el("photo-preview").hidden, true);
  assert.equal(s.el("next-step").disabled, true);
  assert.equal(s.el("send-report").disabled, true);
  assert.equal(s.el("location-values").hidden, true);
  assert.equal(s.map.markers.length, 0);
  assert.equal(s.requests.length, 0);
  assert.equal(s.revoked.length, 1);
  await submit();
  assert.equal(s.el("confirmation-code").textContent, "PR-00002");
  await s.el("view-my-reports").click();
  assert.equal(s.el("temporary-report-list").children.length, 2);
  s.el("create-another-report").click();
  assert.equal(s.el("send-report").disabled, true);
});

async function chooseCategory(s, key) {
  await s.el('choose-' + key).click();
  const select = s.el('incidence-type');
  if (select.children?.length > 1) {
    select.value = select.children[1].value;
    await select.emit('change');
  }
}
function addPhoto(s) {
  s.el("photo-file").files = [{ type: "image/png", name: "incidente.png" }];
  s.el("photo-file").emit("change");
  s.images.at(-1).onload();
}
async function prepareRequired(s) {
  await chooseCategory(s, "vias");
  addPhoto(s);
}

function confirmManual(s, lat = -15.84, lng = -70.02) {
  s.el("use-manual-location").click();
  s.map.events.click({ latlng: { lat, lng } });
  s.el("confirm-location").click();
}

test("Categoría obligatoria bloquea Siguiente y Enter; foto obligatoria bloquea el segundo paso", async () => {
  const s = await setup();
  assert.equal(s.el("next-step").disabled, true);
  await s.el("incidence-form").emit("submit");
  assert.equal(s.el("step-0").hidden, false);
  s.el("next-step").click();
  assert.equal(s.el("step-0").hidden, false);
  await chooseCategory(s, "vias");
  assert.equal(s.el("next-step").disabled, false);
  s.el("next-step").click();
  assert.equal(s.el("next-step").disabled, true);
  assert.equal(s.el("photo-required").hidden, false);
  s.el("description").value = "Solo texto";
  await s.el("incidence-form").emit("submit");
  assert.equal(s.el("step-1").hidden, false);
  addPhoto(s);
  assert.equal(s.el("next-step").disabled, false);
  s.el("next-step").click();
  assert.equal(s.el("next-step").disabled, true);
  confirmManual(s);
  assert.equal(s.el("next-step").disabled, false);
});

test("Sin descripción ni selección de entidad se puede completar el reporte con los tres requisitos", async () => {
  const s = await setup();
  await prepareRequired(s);
  confirmManual(s);
  s.el("description").value = "   ";
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  assert.equal(s.el("review-description-row").hidden, true);
  assert.equal(s.el("send-report").disabled, false);
  await s.el("incidence-form").emit("submit");
  const report = s.snapshots.at(-1);
  assert.equal(report.description, "");
  assert.equal(report.categoryConfirmed, true);
  assert.equal(report.photoConfirmed, true);
  assert.equal(report.location.locationConfirmed, true);
  assert.equal(report.entity, "Área de Vías");
});

test("GPS confirmado no habilita el envío sin categoría y foto; reemplazar o quitar foto vuelve a bloquearlo", async () => {
  const s = await setup();
  confirmManual(s);
  assert.equal(s.el("send-report").disabled, true);
  await chooseCategory(s, "agua");
  assert.equal(s.el("send-report").disabled, true);
  addPhoto(s);
  assert.equal(s.el("send-report").disabled, false);
  s.el("photo-camera").files = [{ type: "image/jpeg", name: "nueva.jpg" }];
  s.el("photo-camera").emit("change");
  assert.equal(s.el("send-report").disabled, true);
  s.images.at(-1).onerror();
  assert.equal(s.el("send-report").disabled, true);
  addPhoto(s);
  s.el("remove-photo").click();
  assert.equal(s.el("send-report").disabled, true);
  assert.equal(s.el("photo-required").hidden, false);
});

test("Cada categoría actualiza su entidad sugerida y la copia de revisión", async () => {
  const s = await setup();
  addPhoto(s);
  confirmManual(s);
  const routing = { vias: "Área de Vías", limpieza: "Área de Limpieza", alumbrado: "Área responsable de alumbrado", agua: "Área responsable de agua y saneamiento" };
  for (const [category, entity] of Object.entries(routing)) {
    await chooseCategory(s, category);
    s.el("review-report").click();
    assert.equal(s.el("entity").textContent, "Recomendación: Entidad de prueba — " + entity);
    assert.equal(s.el("review-entity").textContent, "Entidad de prueba — " + entity);
    assert.equal(s.snapshots.at(-1).entity, entity);
  }
});

test("La capa de datos rechaza categoría desconocida y fotografías no confirmadas", async () => {
  const s = await setup();
  const input = { category: "vias", categoryConfirmed: true, photo: { type: "image/png" }, photoConfirmed: true,
    location: { latitude: 0, longitude: 0, accuracy: null, locationSource: "manual", locationConfirmed: true } };
  assert.throws(() => s.data.snapshot({ ...input, category: "otro" }), /categoría/);
  assert.throws(() => s.data.snapshot({ ...input, categoryConfirmed: false }), /categoría/);
  assert.throws(() => s.data.snapshot({ ...input, photoConfirmed: false }), /fotografía/);
  assert.throws(() => s.data.snapshot({ ...input, photo: null }), /fotografía/);
});

test("El mapa inicia en Puno sin asumir que su centro sea la ubicación del problema", async () => {
  const s = await setup();
  await prepareRequired(s);
  assert.equal(s.el("send-report").disabled, true);
  s.el("next-step").click(); s.el("next-step").click();
  assert.equal(s.map.center[0], -15.8402);
  assert.equal(s.map.center[1], -70.0219);
  assert.equal(s.map.markers.length, 0);
  assert.equal(s.requests.length, 0);
  s.el("next-step").click();
  assert.equal(s.snapshots.length, 0);
  assert.equal(s.el("report-message").textContent, "Debes confirmar la ubicación del incidente para continuar.");
});

test("Los clics mueven un único marcador y confirmar bloquea cualquier cambio hasta editar", async () => {
  const s = await setup();
  await prepareRequired(s);
  s.el("use-manual-location").click();
  s.map.events.click({ latlng: { lat: -15.8, lng: -70 } });
  const marker = s.map.markers[0];
  s.map.events.click({ latlng: { lat: -15.9, lng: -70.1 } });
  assert.equal(s.map.markers.length, 1);
  assert.equal(s.map.markers[0], marker);
  assert.equal(marker.point[0], -15.9);
  assert.equal(s.el("send-report").disabled, true);
  s.el("confirm-location").click();
  assert.equal(s.el("send-report").disabled, false);
  s.map.events.click({ latlng: { lat: -16, lng: -71 } });
  assert.equal(marker.point[0], -15.9);
  s.el("review-report").click();
  assert.equal(s.snapshots[0].location.locationConfirmed, true);
  assert.equal(s.snapshots[0].location.locationSource, "manual");
  s.el("change-location").click();
  assert.equal(s.el("send-report").disabled, true);
  const count = s.snapshots.length;
  await s.el("incidence-form").emit("submit");
  assert.equal(s.snapshots.length, count);
  assert.equal(s.el("step-2").hidden, false);
});

test("GPS de alta precisión centra el mapa y no altera el punto confirmado con otra respuesta", async () => {
  const s = await setup();
  await prepareRequired(s);
  s.el("use-location").click();
  assert.equal(s.requests[0].options.enableHighAccuracy, true);
  assert.equal(s.requests[0].options.timeout, 10000);
  assert.equal(s.requests[0].options.maximumAge, 0);
  s.requests[0].success(position(-15.83, -70.01, 7));
  assert.equal(s.map.center[0], -15.83);
  assert.equal(s.map.markers.length, 1);
  assert.equal(s.el("location-status").textContent, "Ubicación detectada correctamente.");
  assert.equal(s.el("send-report").disabled, true);
  s.el("confirm-location").click();
  s.requests[0].success(position(-16, -71));
  s.el("use-location").click();
  assert.equal(s.requests.length, 1);
  s.el("review-report").click();
  assert.equal(s.snapshots[0].location.latitude, -15.83);
  assert.equal(s.snapshots[0].location.accuracy, 7);
  assert.equal(s.snapshots[0].location.locationSource, "gps");
});

test("La capa de datos rechaza copias sin una ubicación confirmada", async () => {
  const s = await setup();
  const input = { category: "agua", description: "Fuga", photo: null };
  assert.throws(() => s.data.snapshot(input), /Debes confirmar/);
  assert.throws(() => s.data.snapshot({ ...input, location: { latitude: 0, longitude: 0, accuracy: null, locationSource: "manual", locationConfirmed: false } }), /Debes confirmar/);
});

test("Mapa sin conexión informa del error; GPS y la selección con teclado tienen manejo propio", async () => {
  const absent = await setup({ leaflet: false });
  absent.el("use-manual-location").click();
  assert.match(absent.el("map-status").textContent, /No se pudo cargar/);
  assert.equal(absent.el("confirm-location").disabled, true);
  const s = await setup();
  s.el("use-manual-location").click();
  s.tileEvents.tileerror();
  assert.match(s.el("map-status").textContent, /cartografía/);
  s.el("report-map").emit("keydown", { key: "Enter" });
  assert.equal(s.map.markers.length, 1);
  assert.equal(s.el("confirm-location").disabled, false);
});

test("Formulario continuo muestra todos los paneles y conserva los datos", async () => {
  const s = await setup();
  assert.equal(s.el("step-0").hidden, false);
  assert.equal(s.el("send-report").hidden, false);
  await chooseCategory(s, "agua");
  assert.equal(s.el("category").value, "agua");
  assert.equal(s.el("choose-agua").attrs["aria-pressed"], "true");
  assert.equal(s.el("choose-vias").attrs["aria-pressed"], "false");
  s.el("next-step").click();
  s.el("description").value = "Fuga de agua";
  s.el("previous-step").click();
  assert.equal(s.el("category").value, "agua");
  assert.equal(s.el("description").value, "Fuga de agua");
  confirmManual(s);
  addPhoto(s);
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  assert.equal(s.el("step-3").hidden, false);
  for (let i = 0; i < 3; i++) assert.equal(s.el(`step-${i}`).hidden, false);
  assert.equal(s.el("send-report").hidden, false);
  assert.equal(s.el("report-review").hidden, false);
  assert.equal(s.el("review-description").textContent, "Fuga de agua");
  s.el("edit-report").click();
  assert.equal(s.el("step-0").hidden, false);
});

test("Enter en los primeros pasos avanza sin guardar ni enviar", async () => {
  const s = await setup();
  await chooseCategory(s, "vias");
  await s.el("incidence-form").emit("submit");
  assert.equal(s.el("step-1").hidden, false);
  assert.equal(s.snapshots.length, 0);
  assert.doesNotMatch(s.el("report-message").textContent, /Prueba completada/);
});

test("No se avanza mientras una foto carga o falta confirmar el punto manual", async () => {
  const s = await setup();
  await chooseCategory(s, "vias");
  s.el("next-step").click();
  s.el("photo-file").files = [{ type: "image/png", name: "foto.png" }];
  s.el("photo-file").emit("change");
  s.el("next-step").click();
  assert.equal(s.el("step-1").hidden, false);
  s.images[0].onload();
  s.el("next-step").click();
  s.el("use-manual-location").click();
  s.map.events.click({ latlng: { lat: -15, lng: -70 } });
  s.el("next-step").click();
  assert.equal(s.el("step-2").hidden, false);
  s.el("confirm-location").click();
  s.el("next-step").click();
  assert.equal(s.el("step-3").hidden, false);
  assert.equal(s.el("review-photo-image").hidden, false);
});

test("GPS se solicita únicamente al pulsar y la copia conserva la ubicación elegida", async () => {
  const s = await setup();
  await prepareRequired(s);
  assert.equal(s.requests.length, 0);
  s.el("use-location").click();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].options.maximumAge, 0);
  s.requests[0].success(position(-15.84, -70.02));
  s.el("confirm-location").click();
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  const saved = s.snapshots[0];
  assert.equal(saved.location.latitude, -15.84);
  assert.equal(saved.location.accuracy, 12);
  assert.ok(Object.isFrozen(saved.location));
  s.el("change-location").click();
  s.el("use-location").click();
  s.requests[1].success(position(-16, -71));
  assert.equal(saved.location.latitude, -15.84);
  assert.match(s.el("report-message").textContent, /cambios posteriores/);
});

test("Una respuesta GPS tardía no sustituye las coordenadas manuales", async () => {
  const s = await setup();
  await prepareRequired(s);
  s.el("use-location").click();
  s.el("use-manual-location").click();
  s.map.events.click({ latlng: { lat: 0, lng: 0 } });
  s.el("confirm-location").click();
  s.requests[0].success(position(-15, -70));
  for (let i = 0; i < 3; i++) s.el("next-step").click();
  await s.el("incidence-form").emit("submit");
  assert.equal(s.snapshots[0].location.latitude, 0);
  assert.equal(s.snapshots[0].location.locationSource, "manual");
  assert.equal(s.snapshots[0].location.accuracy, null);
});

test("No se revisa una lectura pendiente; denegación, timeout y ubicación no disponible permiten reintentar", async () => {
  for (const code of [1, 2, 3]) {
    const s = await setup();
    s.el("use-location").click();
    s.el("review-report").click();
    assert.equal(s.snapshots.length, 0);
    assert.equal(s.el("use-location").disabled, true);
    assert.equal(s.el("confirm-location").disabled, true);
    assert.equal(s.el("send-report").disabled, true);
    s.el("use-location").click();
    assert.equal(s.requests.length, 1);
    s.requests[0].failure({ code });
    assert.equal(s.el("use-location").disabled, false);
    assert.equal(s.el("location-status").textContent, code === 1
      ? "No se pudo acceder a tu ubicación. Selecciona el lugar manualmente en el mapa."
      : "No pudimos obtener tu ubicación. Inténtalo nuevamente o selecciónala manualmente.");
    assert.equal(s.el("send-report").disabled, true);
    s.el("use-location").click();
    assert.equal(s.requests.length, 2);
  }
});

test("Sin contexto seguro o sin API se ofrece la entrada manual sin solicitar GPS", async () => {
  for (const options of [{ secure: false }, { geo: false }]) {
    const s = await setup(options);
    await prepareRequired(s);
    s.el("use-location").click();
    assert.equal(s.requests.length, 0);
    assert.equal(s.el("location-status").textContent, options.secure === false
      ? "No podemos obtener automáticamente tu ubicación en esta conexión. Puedes seleccionarla manualmente en el mapa."
      : "No se pudo acceder a tu ubicación. Selecciona el lugar manualmente en el mapa.");
    assert.doesNotMatch(s.el("location-status").textContent, /HTTPS|localhost|geolocation/);
    assert.equal(s.el("send-report").disabled, true);
    confirmManual(s);
    assert.equal(s.el("send-report").disabled, false);
  }
});

test("Un punto manual sin confirmar bloquea la copia y las coordenadas fuera de rango se rechazan", async () => {
  const s = await setup();
  s.el("use-manual-location").click();
  s.el("latitude").value = "-15";
  s.el("latitude").emit("input");
  s.el("review-report").click();
  assert.equal(s.snapshots.length, 0);
  for (const values of [[91, 0], [0, 181], [NaN, 0], [0, 0, -1]]) {
    assert.throws(() => s.data.coordinates(...values));
  }
});

test("La previsualización libera recursos, ignora fotos reemplazadas y maneja formatos inválidos", async () => {
  const s = await setup();
  const input = s.el("photo-file");
  input.files = [{ type: "image/png", name: "primera.png" }]; input.emit("change");
  s.el("review-report").click();
  assert.equal(s.snapshots.length, 0);
  input.files = [{ type: "image/jpeg", name: "segunda.jpg" }]; input.emit("change");
  s.images[0].onload();
  assert.equal(s.el("photo-preview").hidden, true);
  s.images[1].onload();
  assert.equal(s.el("photo-name").textContent, "segunda.jpg");
  assert.equal(s.el("photo-preview").hidden, false);
  input.files = []; input.emit("change");
  assert.equal(s.el("photo-name").textContent, "segunda.jpg");
  s.el("remove-photo").click();
  assert.equal(s.revoked.length, 2);
  input.files = [{ type: "text/plain", name: "no.txt" }]; input.emit("change");
  assert.match(s.el("photo-status").textContent, /JPG, JPEG, PNG o WEBP/);
  input.files = [{ type: "image/png", name: "rota.png" }]; input.emit("change");
  s.images[2].onerror();
  assert.match(s.el("photo-status").textContent, /no puede abrir/);
});

test("El resumen trata la descripción como texto y no genera HTML", async () => {
  const s = await setup();
  await prepareRequired(s);
  confirmManual(s);
  s.el("description").value = '<img src=x onerror="alert(1)">';
  s.el("review-report").click();
  assert.equal(s.el("review-description").textContent, s.el("description").value);
  assert.equal(s.el("review-description").innerHTML, undefined);
});


const remoteRows = () => [13, 12, 11].map((id, index) => ({
  id_reporte: String(id), id_usuario: "1", codigo: "PR-REAL-" + id,
  id_categoria: "1", categoria: "V?as", id_tipo_incidencia: null, tipo_incidencia: null,
  descripcion: id === 12 ? "" : "Incidencia " + id, estado: ["Reportado", "En proceso", "Solucionado"][index],
  fecha_registro: "2026-10-" + id + "T15:00:00.000Z", latitud: -15.84, longitud: -70.02,
  origen_ubicacion: "MANUAL", precision_metros: null, id_area_responsable: "1", area_responsable: "?rea de V?as",
  archivos: [{ id_archivo: String(id), tipo_archivo: "INCIDENCIA", ruta_archivo: "/uploads/incidencias/" + id + ".png" }]
}));

test("Dashboard limita a cinco, omite tipo nulo y usa coordenadas y fechas reales", async () => {
  const rows = [...remoteRows(), ...remoteRows().map((r,i) => ({ ...r, id_reporte: String(i+20), codigo: `PR-REAL-${i+20}`, fecha_registro: `2026-10-${i+20}T15:00:00.000Z` }))];
  rows[0].tipo_incidencia = "Bache";
  rows[1].latitud = null;
  const s = await setup({ reportsFetch: async () => ({ ok: true, json: async () => rows }) });
  await s.el("citizen-home").click();
  assert.equal(s.el("dashboard-total").textContent, "6");
  assert.equal(s.el("dashboard-recent").children.length, 5);
  assert.equal(s.el("dashboard-recent").children[0].children[1].children[0].textContent, "PR-REAL-22");
  assert.equal(s.el("dashboard-activity").children.length, 4);
  assert.equal(s.el("dashboard-activity").children[0].children[0].textContent, "Reporte PR-REAL-22 registrado");
  assert.equal(s.map.markers.length, 5);
  assert.deepEqual(Array.from(s.map.markers[0].point), [-15.84, -70.02]);
  assert.equal(s.requests.length, 0);
  const info = s.el("dashboard-recent").children[3].children[1];
  assert.equal(info.children.find(e => e.className === "dashboard-type").textContent, "Bache");
  const noDescription = s.el("dashboard-recent").children[4].children[1];
  assert.equal(noDescription.children.find(e => e.className === "dashboard-description").textContent, "Sin descripción");
  await s.el("citizen-report").click();
  assert.equal(s.map.markers.length, 0);
  const offlineMap = await setup({ leaflet: false, reportsFetch: async () => ({ ok: true, json: async () => rows }) });
  await offlineMap.el("citizen-home").click();
  assert.match(offlineMap.el("dashboard-map-status").textContent, /No se pudo cargar el mapa/);
});

test("API alimenta lista, detalle, fotos, cach? y contadores sin duplicar registros", async () => {
  const s = await setup({ reportsFetch: async url => {
    assert.equal(url, "http://127.0.0.1:3001/api/reportes");
    return { ok: true, json: async () => remoteRows() };
  } });
  await s.el("citizen-reports").click();
  assert.equal(s.el("temporary-report-list").children.length, 3);
  await s.el("temporary-report-list").children[1].children[3].click();
  assert.equal(s.el("detail-code").textContent, "PR-REAL-12");
  assert.equal(s.el("detail-type").textContent, "Sin especificar");
  assert.equal(s.el("detail-description-block").hidden, true);
  assert.equal(s.el("detail-photo").src, "http://127.0.0.1:3001/uploads/incidencias/12.png");
  assert.equal(s.el("detail-latitude").textContent, "-15.84");
  assert.equal(s.requests.length, 0);
  await s.el("citizen-home").click();
  assert.equal(s.el("dashboard-total").textContent, "3");
  for (const id of ["dashboard-reported", "dashboard-progress", "dashboard-solved"]) assert.equal(s.el(id).textContent, "1");
  assert.equal(s.el("dashboard-recent").children[0].children[1].children[0].textContent, "PR-REAL-13");
  await s.el("dashboard-recent").children[2].children[4].click();
  assert.equal(s.el("detail-code").textContent, "PR-REAL-11");
  assert.equal(JSON.parse(s.storage.get("puno-reporta-reports-user-1")).length, 3);
});

test("Carga, error con respaldo, vac?o autoritativo y navegaci?n durante consulta", async () => {
  let resolve;
  const s = await setup({ reportsFetch: () => new Promise(r => { resolve = r; }) });
  const pending = s.el("citizen-reports").click();
  assert.match(s.el("reports-data-status").textContent, /Cargando/);
  await s.el("citizen-report").click();
  resolve({ ok: true, json: async () => remoteRows() }); await pending;
  assert.equal(s.el("my-reports").hidden, true);
  const offline = await setup({ storage: s.storage });
  await offline.el("citizen-reports").click();
  assert.equal(offline.el("temporary-report-list").children.length, 3);
  assert.match(offline.el("reports-data-status").textContent, /respaldo local/);
  const empty = await setup({ storage: s.storage, reportsFetch: async () => ({ ok: true, json: async () => [] }) });
  await empty.el("citizen-reports").click();
  assert.equal(empty.el("temporary-report-list").children.length, 0);
  assert.match(empty.el("reports-data-status").textContent, /A?n no tienes reportes/);
  await empty.el("citizen-home").click();
  assert.equal(empty.el("dashboard-empty").hidden, false);
  const failed = await setup(); await failed.el("citizen-reports").click();
  assert.match(failed.el("reports-data-status").textContent, /No se pudieron cargar/);
});


const aiResult = {ok:true,analisis:{id_categoria:'1',categoria:'Vías',id_tipo_incidencia:'11',tipo:'Problema de prueba',descripcion:'Se observa un bache.',area_responsable:'Área de Vías',confianza:null}};
test('IA: solo analiza al pulsar, aplica sugerencias editables y conserva destino SQL',async()=>{
 let calls=0;const s=await setup({aiFetch:async()=>{calls++;return {ok:true,json:async()=>aiResult};}});
 addPhoto(s);assert.equal(calls,0);assert.equal(s.el('retry-analysis').hidden,false);
 await s.el('retry-analysis').click();assert.equal(calls,1);
 assert.equal(s.categories.getSelected().id_categoria,'1');assert.equal(s.categories.getSelectedType().id_tipo_incidencia,'11');
 assert.equal(s.el('description').value,'Se observa un bache.');assert.equal(s.el('ai-result').hidden,false);assert.equal(s.el('destination').value,'1');
 s.el('description').value='Texto corregido';await s.el('description').emit('input');await s.el('choose-limpieza').click();assert.equal(calls,1);
 assert.equal(s.el('description').value,'Texto corregido');assert.equal(s.el('destination').value,'2');
});
test('IA: nueva fotografía descarta sugerencias y respuesta tardía, bloquea clics duplicados',async()=>{
 let resolve,calls=0;const s=await setup({aiFetch:()=>{calls++;return new Promise(r=>resolve=r);}});
 addPhoto(s);const pending=s.el('retry-analysis').click();await s.el('retry-analysis').click();assert.equal(calls,1);
 assert.equal(s.el('retry-analysis').disabled,true);assert.equal(s.el('send-report').disabled,true);
 addPhoto(s);resolve({ok:true,json:async()=>aiResult});await pending;
 assert.equal(s.el('ai-result').hidden,true);assert.equal(s.categories.getSelected(),null);
 await s.el('choose-vias').click();assert.equal(s.el('destination').value,'1');
});
test('IA: fallo permite completar el registro manual y la foto sigue disponible',async()=>{
 const s=await setup();addPhoto(s);await s.el('retry-analysis').click();
 assert.match(s.el('ai-status').textContent,/Puedes seleccionarlo manualmente/);assert.equal(s.el('photo-preview').hidden,false);
 await s.el('choose-vias').click();confirmManual(s);await s.el('incidence-form').emit('submit');assert.equal(s.posts.length,1);assert.equal(s.uploads.length,1);
});
test('IA: reemplazar foto elimina texto generado sin borrar texto editado',async()=>{
 const s=await setup({aiFetch:async()=>({ok:true,json:async()=>aiResult})});addPhoto(s);await s.el('retry-analysis').click();
 addPhoto(s);assert.equal(s.el('description').value,'');assert.equal(s.categories.getSelected(),null);assert.equal(s.el('ai-result').hidden,true);
 await s.el('retry-analysis').click();s.el('description').value='Mi descripción';addPhoto(s);assert.equal(s.el('description').value,'Mi descripción');
});
