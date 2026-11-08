const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createApiRouter = require("../routes/api");

test("Health y categorías consultan PostgreSQL y manejan errores sin exponer detalles", async () => {
  const queries = [];
  let fail = false;
  const rows = [{ id_categoria: 1, nombre: "Vías", descripcion: "Infraestructura vial" }];
  const pool = {
    options: { database: "puno_reporta" },
    async query(sql) {
      queries.push(sql);
      if (fail) throw Object.assign(new Error("detalle privado"), { code: "TEST_FAILURE" });
      return { rows: sql.startsWith("SELECT NOW") ? [{ now: new Date() }] : rows };
    },
  };
  const app = express();
  app.use("/api", createApiRouter(pool));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, message: "PUNO REPORTA API conectada correctamente", database: "puno_reporta" });
    assert.equal(queries[0], "SELECT NOW();");
    const categories = await fetch(`${url}/categorias`);
    assert.equal(categories.status, 200);
    assert.deepEqual(await categories.json(), rows);
    assert.match(queries[1], /SELECT id_categoria, nombre, descripcion\s+FROM categoria\s+WHERE activo = TRUE\s+ORDER BY id_categoria;/);
    fail = true;
    for (const [route, status] of [["health", 503], ["categorias", 500]]) {
      const response = await fetch(`${url}/${route}`);
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.doesNotMatch(JSON.stringify(body), /detalle privado|TEST_FAILURE/);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
