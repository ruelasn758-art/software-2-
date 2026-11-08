const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const handlers = require("../controllers/archivos");

test("Fotografía HTTP: validación, disco, SQL, reintento, estático y limpieza en error", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puno-upload-"));
  let record = null, exists = true, failInsert = false, failUpdate = false;
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT id_reporte")) return { rows: exists ? [{ id_reporte: "1" }] : [] };
      if (sql.startsWith("SELECT *")) return { rows: record ? [record] : [] };
      if (sql.startsWith("UPDATE archivo_reporte")) {
        if (failUpdate) throw new Error("sensitive update detail");
        assert.equal(params[3], record.id_archivo);
        assert.equal(params[4], record.id_reporte);
        record = { ...record, ruta_archivo: params[0], nombre_original: params[1], descripcion: params[2] };
        return { rows: [record] };
      }
      if (sql.includes("INSERT INTO")) {
        if (failInsert) throw new Error("sensitive db detail");
        record = { id_archivo: "1", id_reporte: params[0], tipo_archivo: "INCIDENCIA", ruta_archivo: params[1], nombre_original: params[2], descripcion: params[3] };
        return { rows: [record] };
      }
      return { rows: [] };
    }, release() {},
  };
  const app = express();
  app.post("/api/reportes/:id_reporte/archivos", ...handlers({ query: client.query, connect: async () => client }, root));
  app.use("/uploads", express.static(root));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6sAAAAASUVORK5CYII=", "base64");
  async function send({ bytes = png, name = "foto.png", mime = "image/png", type = "INCIDENCIA", report = "1", description } = {}) {
    const data = new FormData();
    data.append("archivo", new Blob([bytes], { type: mime }), name);
    data.append("tipo_archivo", type);
    if (description !== undefined) data.append("descripcion", description);
    const response = await fetch(`${base}/api/reportes/${report}/archivos`, { method: "POST", body: data });
    return { status: response.status, body: await response.json() };
  }
  exists = false;
  assert.equal((await send()).status, 404);
  assert.deepEqual(await fs.readdir(root), []);
  exists = true;
  assert.equal((await send({ report: "abc" })).status, 400);
  assert.equal((await send({ type: "SOLUCION" })).status, 400);
  assert.equal((await send({ name: "foto.svg", mime: "image/svg+xml" })).status, 415);
  assert.equal((await send({ bytes: Buffer.from("not a png") })).status, 400);
  assert.equal((await send({ bytes: Buffer.alloc(8 * 1024 * 1024 + 1) })).status, 413);
  const result = await send();
  assert.equal(result.status, 201);
  assert.equal(result.body.archivo.nombre_original, "foto.png");
  assert.equal(result.body.archivo.tipo_archivo, "INCIDENCIA");
  const image = await fetch(base + result.body.archivo.ruta_archivo);
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  await t.test("Archivo físico existente: reintento no escribe ni modifica metadatos", async () => {
    const mutationsBefore = queries.filter(q => /INSERT INTO|UPDATE archivo_reporte/.test(q.sql)).length;
    const retry = await send({ name: "otra.png" });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.archivo, result.body.archivo);
    assert.equal(queries.filter(q => /INSERT INTO|UPDATE archivo_reporte/.test(q.sql)).length, mutationsBefore);
    assert.equal((await fs.readdir(path.join(root, "incidencias"))).length, 1);
  });
  await fs.unlink(path.join(root, record.ruta_archivo.slice("/uploads/".length)));
  const missingRecord = { ...record };
  await t.test("Error al actualizar registro ausente: rollback y ningún archivo huérfano", async () => {
    failUpdate = true;
    const failed = await send();
    assert.equal(failed.status, 500);
    assert.doesNotMatch(JSON.stringify(failed), /sensitive/);
    assert.deepEqual(record, missingRecord);
    assert.deepEqual(await fs.readdir(path.join(root, "incidencias")), []);
    assert.equal(queries.at(-1).sql, "ROLLBACK");
    failUpdate = false;
  });
  await t.test("Error de escritura parcial: elimina únicamente el archivo nuevo y conserva registro", async () => {
    const originalOpen = fs.open;
    const mocked = t.mock.method(fs, "open", async (...args) => {
      const handle = await originalOpen(...args);
      return {
        async writeFile(bytes) {
          await handle.writeFile(bytes.subarray(0, 8));
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
        close: () => handle.close(),
      };
    });
    try {
      const failed = await send();
      assert.equal(failed.status, 500);
      assert.equal(failed.body.ok, false);
      assert.deepEqual(record, missingRecord);
      assert.deepEqual(await fs.readdir(path.join(root, "incidencias")), []);
      assert.equal(queries.at(-1).sql, "ROLLBACK");
    } finally { mocked.mock.restore(); }
  });
  await t.test("Archivo ausente: repara el mismo ID y el siguiente reintento no duplica", async () => {
    const repaired = await send({ name: "reparada.png", description: "Fotografía recuperada" });
    assert.equal(repaired.status, 200);
    assert.equal(repaired.body.archivo.id_archivo, missingRecord.id_archivo);
    assert.equal(repaired.body.archivo.id_reporte, missingRecord.id_reporte);
    assert.notEqual(repaired.body.archivo.ruta_archivo, missingRecord.ruta_archivo);
    assert.equal(repaired.body.archivo.nombre_original, "reparada.png");
    assert.equal(repaired.body.archivo.descripcion, "Fotografía recuperada");
    const image = await fetch(base + repaired.body.archivo.ruta_archivo);
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const retry = await send();
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.archivo, repaired.body.archivo);
    assert.equal(queries.filter(q => q.sql.includes("INSERT INTO")).length, 1);
    assert.equal((await fs.readdir(path.join(root, "incidencias"))).length, 1);
  });
  record = null; failInsert = true;
  const failed = await send();
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(failed), /sensitive/);
  assert.equal((await fs.readdir(path.join(root, "incidencias"))).length, 1);
  assert.ok(queries.some(q => q.sql === "ROLLBACK"));
});
