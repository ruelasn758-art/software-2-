const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const router = require("../routes/api");
const { validate, createReport, generateCode } = require("../services/reportes");
const input = { id_usuario: 1, id_categoria: 1, id_tipo_incidencia: 1, latitud: -15.8402, longitud: -70.0219, origen_ubicacion: "GPS", precision_metros: 8.5 };

function mock({ badType = false, badCategory = false, ambiguousArea = false, noArea = false, historyFailure = false, collision = false } = {}) {
  const calls = []; let released = false; let inserts = 0;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id_usuario")) return { rows: [{ id_usuario: "1" }] };
      if (sql.startsWith("SELECT id_categoria")) return { rows: badCategory ? [] : [{ id_categoria: "1" }] };
      if (sql.startsWith("SELECT t.")) return { rows: badType ? [] : [{ id_tipo_incidencia: "1" }] };
      if (sql.startsWith("SELECT ca.")) return { rows: noArea ? [] : ambiguousArea ? [{ id_area: "2", prioridad: 1 }, { id_area: "3", prioridad: 1 }] : [{ id_area: "2", prioridad: 1 }] };
      if (sql.startsWith("SELECT id_estado")) return { rows: [{ id_estado: "3" }] };
      if (sql.startsWith("INSERT INTO reporte")) {
        inserts++;
        return { rows: collision && inserts === 1 ? [] : [{ id_reporte: "10", codigo: values[0], id_area_responsable: "2" }] };
      }
      if (sql.startsWith("INSERT INTO historial") && historyFailure) throw new Error("secret internal failure");
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { pool: { connect: async () => client, query: async () => ({ rows: [{ id_tipo_incidencia: "1", nombre: "Bache" }] }) }, calls, get released() { return released; } };
}

test("Valida campos, rangos, IDs bigint y valores asignados por el servidor", () => {
  assert.equal(validate(input).descripcion, null);
  assert.equal(validate({ ...input, latitud: 0, longitud: 0 }).latitud, 0);
  assert.equal(validate({ ...input, id_usuario: "9007199254740993" }).id_usuario, "9007199254740993");
  for (const key of ["id_usuario", "id_categoria", "latitud", "longitud", "origen_ubicacion"]) {
    const body = { ...input }; delete body[key]; assert.throws(() => validate(body));
  }
  for (const patch of [{ latitud: 91 }, { longitud: -181 }, { latitud: null }, { longitud: "0" }, { precision_metros: -1 }, { precision_metros: 1000000 }, { origen_ubicacion: "otro" }, { id_estado: 1 }, { id_area_responsable: 1 }, { codigo: "mio" }, { id_usuario: "9223372036854775808" }, { descripcion: {} }]) assert.throws(() => validate({ ...input, ...patch }));
  const codes = new Set(Array.from({ length: 500 }, generateCode));
  assert.equal(codes.size, 500);
  assert.ok([...codes].every(code => code.length <= 30));
});

test("Transacción usa área/estado consultados, longitud primero e historial antes de COMMIT", async () => {
  const m = mock({ collision: true });
  const result = await createReport(m.pool, validate(input));
  const insert = m.calls.find(c => c.sql.startsWith("INSERT INTO reporte"));
  assert.deepEqual(insert.values.slice(4, 6), ["2", "3"]);
  assert.deepEqual(insert.values.slice(7, 9), [input.longitud, input.latitud]);
  assert.match(insert.sql, /ST_SetSRID\(ST_MakePoint\(\$8, \$9\), 4326\)::geography/);
  assert.match(m.calls.at(-2).sql, /INSERT INTO historial_estado/);
  assert.deepEqual(m.calls.at(-2).values, ["10", "3", "1", "Reporte registrado por el ciudadano"]);
  assert.equal(m.calls.at(-1).sql, "COMMIT");
  assert.equal(result.estado, "Reportado");
  assert.equal(m.released, true);
});

test("Tipo opcional: valida categoría independientemente y rechaza tipos inválidos", async () => {
  for (const value of [null, undefined]) {
    const data = validate({ ...input, id_tipo_incidencia: value });
    assert.equal(data.id_tipo_incidencia, null);
    const m = mock(); await createReport(m.pool, data);
    assert.equal(m.calls.some(c => c.sql.startsWith("SELECT t.")), false);
    assert.equal(m.calls.find(c => c.sql.startsWith("INSERT INTO reporte")).values[3], null);
    for (const options of [{ badCategory: true }, { ambiguousArea: true }]) {
      const bad = mock(options); await assert.rejects(() => createReport(bad.pool, data));
      assert.equal(bad.calls.at(-1).sql, "ROLLBACK");
    }
  }
  for (const value of ["", 0, "null", -1, {}, 1.5]) assert.throws(() => validate({ ...input, id_tipo_incidencia: value }));
});

test("Tipo ajeno, área ausente o fallo de historial revierten todo y liberan cliente", async () => {
  for (const options of [{ badType: true }, { noArea: true }, { historyFailure: true }]) {
    const m = mock(options);
    await assert.rejects(() => createReport(m.pool, validate(input)));
    assert.equal(m.calls.at(-1).sql, "ROLLBACK");
    assert.equal(m.calls.some(c => c.sql === "COMMIT"), false);
    assert.equal(m.released, true);
  }
});

test("HTTP: tipos, 201 y errores 400/500 sin filtrar detalles internos", async () => {
  const m = mock(); const app = express(); app.use(express.json()); app.use("/api", router(m.pool,{session:require('./session-fixture.cjs')}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/tipos-incidencia?categoria=1`)).status, 200);
    assert.equal((await fetch(`${base}/tipos-incidencia?categoria=foo`)).status, 400);
    const post = body => fetch(`${base}/reportes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    assert.equal((await post(input)).status, 201);
    m.pool.connect = mock({ badType: true }).pool.connect;
    assert.equal((await post(input)).status, 400);
    m.pool.connect = mock({ historyFailure: true }).pool.connect;
    const response = await post(input);
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /secret internal failure/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test("GET reportes fija usuario, parametriza filtro y oculta errores internos", async () => {
  let calls = 0;
  const pool = { query: async (sql, values) => {
    calls++;
    assert.match(sql, /WHERE r.id_usuario = \$1 AND r.activo = TRUE/);
    assert.match(sql, /LEFT JOIN tipo_incidencia/);
    assert.deepEqual(values, ["1"]);
    throw new Error("secret password internal failure");
  } };
  const app = express(); app.use("/api", router(pool,{session:require('./session-fixture.cjs')}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(base + "/api/reportes?id_usuario=2")).status, 403);
    assert.equal(calls, 0);
    const response = await fetch(base + "/api/reportes");
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /secret|password/);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
