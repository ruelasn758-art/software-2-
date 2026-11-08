const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { Client } = require("pg");
const environment = require("../config/test-environment");
const createRouter = require("../routes/api");

test("API real aislada: categoría/tipo, historial, fotografía y reintento sin alterar históricos", async () => {
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: environment.user, password: process.env.DB_PASSWORD };
  const client = new Client({ ...config, database: environment.database });
  let server, root;
  try {
    await client.connect();
    assert.equal((await client.query("SELECT current_database() AS db")).rows[0].db, "puno_reporta_prueba_ia");
    const initial = (await client.query("SELECT count(*) AS n FROM reporte")).rows[0].n;
    const originalIA = (await client.query("SELECT count(*) AS n FROM clasificacion_ia")).rows[0].n;
    await fs.mkdir(environment.uploads, { recursive: true });
    root = await fs.mkdtemp(path.join(environment.uploads, "integration-"));
    await client.query("BEGIN");
    // Mantiene la transacción exterior; cada petición utiliza su SAVEPOINT.
    const adapter = {
      query(sql, params) {
        if (sql === "BEGIN") return client.query("SAVEPOINT request");
        if (sql === "COMMIT") return client.query("RELEASE SAVEPOINT request");
        if (sql === "ROLLBACK") return client.query("ROLLBACK TO SAVEPOINT request");
        return client.query(sql, params);
      }, release() {},
    };
    const pool = { options: { database: environment.database }, query: (sql, params) => client.query(sql, params), connect: async () => adapter };
    const app = express(); app.use(express.json());
    app.use("/api", createRouter(pool, { uploadRoot: root }));
    app.use("/uploads", express.static(root));
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await (await fetch(base + "/api/health")).json()).database, environment.database);
    const categories = await (await fetch(base + "/api/categorias")).json(); assert.ok(categories.length);
    const types = await (await fetch(base + `/api/tipos-incidencia?categoria=${categories[0].id_categoria}`)).json(); assert.ok(types.length);
    const payload = { id_usuario: 1, id_categoria: categories[0].id_categoria, descripcion: "Prueba aislada reversible", latitud: -15.84, longitud: -70.02, origen_ubicacion: "MANUAL" };
    const post = body => fetch(base + "/api/reportes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6sAAAAASUVORK5CYII=", "base64");
    for (const type of [undefined, null, types[0].id_tipo_incidencia]) {
      const response = await post({ ...payload, id_tipo_incidencia: type }); assert.equal(response.status, 201);
      const { reporte } = await response.json();
      const saved = (await client.query("SELECT id_tipo_incidencia,id_area_responsable FROM reporte WHERE id_reporte=$1", [reporte.id_reporte])).rows[0];
      assert.equal(saved.id_tipo_incidencia, type ?? null);
      assert.equal(saved.id_area_responsable, reporte.id_area_responsable);
      assert.equal((await client.query("SELECT count(*) AS n FROM historial_estado WHERE id_reporte=$1", [reporte.id_reporte])).rows[0].n, "1");
      const upload = async () => { const data = new FormData(); data.append("archivo", new Blob([png], { type: "image/png" }), "prueba.png"); data.append("tipo_archivo", "INCIDENCIA"); return fetch(base + `/api/reportes/${reporte.id_reporte}/archivos`, { method: "POST", body: data }); };
      const uploaded = await upload(); assert.equal(uploaded.status, 201); const result = await uploaded.json();
      assert.deepEqual(Buffer.from(await (await fetch(base + result.archivo.ruta_archivo)).arrayBuffer()), png);
      const listed = await (await fetch(base + "/api/reportes")).json();
      const listedReport = listed.find(r => r.id_reporte === reporte.id_reporte);
      assert.ok(listedReport);
      assert.equal(listedReport.id_tipo_incidencia, type ?? null);
      assert.equal(listedReport.archivos[0].ruta_archivo, result.archivo.ruta_archivo);
      assert.equal(listedReport.latitud, payload.latitud);
      assert.equal(listedReport.longitud, payload.longitud);
      assert.equal((await upload()).status, 200);
      assert.equal((await client.query("SELECT count(*) AS n FROM archivo_reporte WHERE id_reporte=$1", [reporte.id_reporte])).rows[0].n, "1");
    }
    for (const patch of [{ id_tipo_incidencia: "" }, { id_tipo_incidencia: 0 }, { id_tipo_incidencia: 999999 }, { id_categoria: 999999 }]) assert.equal((await post({ ...payload, ...patch })).status, 400);
    const foreignType = (await client.query("SELECT id_tipo_incidencia FROM tipo_incidencia WHERE id_categoria<>$1 LIMIT 1", [payload.id_categoria])).rows[0];
    assert.equal((await post({ ...payload, id_tipo_incidencia: foreignType.id_tipo_incidencia })).status, 400);
    assert.equal((await client.query("SELECT count(*) AS n FROM clasificacion_ia")).rows[0].n, originalIA);
    await client.query("ROLLBACK");
    assert.equal((await client.query("SELECT count(*) AS n FROM reporte")).rows[0].n, initial);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query("ROLLBACK").catch(() => {}); await client.end();
    if (root && path.dirname(path.resolve(root)) === path.resolve(environment.uploads) && path.basename(root).startsWith("integration-")) await fs.rm(root, { recursive: true, force: true });
  }
});
