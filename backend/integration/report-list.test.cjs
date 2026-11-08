const { test } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../server");
const pool = require("../config/database");

test("GET real: solo usuario 1, reportes 11/12/13 y fotografías accesibles", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const identity = (await pool.query("SELECT current_database() AS db, current_user AS role")).rows[0];
    assert.equal(identity.db, "puno_reporta_prueba_ia");
    assert.equal(identity.role, "puno_reporta_test_app");
    const response = await fetch(base + "/api/reportes");
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.ok(rows.every(r => r.id_usuario === "1"));
    for(const report of rows) {
      const expectedHistory=await pool.query("SELECT count(*)::int AS n FROM historial_estado WHERE id_reporte=$1",[report.id_reporte]);
      assert.equal(report.historial.length,expectedHistory.rows[0].n);
      assert.ok(report.historial.every(h=>h.estado && h.fecha_cambio));
    }
    const expected = await pool.query("SELECT id_reporte FROM reporte WHERE id_usuario=1 AND activo=TRUE");
    assert.deepEqual(rows.map(r => r.id_reporte).sort(), expected.rows.map(r => r.id_reporte).sort());
    for (const id of ["11", "12", "13"]) {
      const report = rows.find(r => r.id_reporte === id);
      assert.ok(report, `Falta reporte ${id}`);
      const photo = report.archivos.find(f => f.tipo_archivo === "INCIDENCIA");
      assert.ok(photo);
      const image = await fetch(base + photo.ruta_archivo);
      assert.equal(image.status, 200);
      assert.match(image.headers.get("content-type"), /^image\//);
      assert.ok((await image.arrayBuffer()).byteLength > 0);
    }
    assert.equal((await fetch(base + "/api/reportes?id_usuario=2")).status, 403);
    assert.equal((await fetch(base + "/api/reportes?id_usuario=1%20OR%201=1")).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
