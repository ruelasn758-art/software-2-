const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
test("La configuración rechaza base principal, superusuario y puerto principal antes de conectar", () => {
  for (const patch of [{ DB_NAME: "puno_reporta" }, { DB_USER: "postgres" }, { PORT: "3000" }]) {
    const result = spawnSync(process.execPath, ["-e", "require('./config/test-environment')"], {
      cwd: path.join(__dirname, ".."), encoding: "utf8",
      env: { ...process.env, DB_NAME: "puno_reporta_prueba_ia", DB_USER: "puno_reporta_test_app", PORT: "3001", ...patch },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Entorno rechazado|puerto 3001/);
  }
});
