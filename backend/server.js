"use strict";

const environment = require("./config/test-environment");
const express = require("express");
const cors = require("cors");
const pool = require("./config/database");
const createApiRouter = require("./routes/api");

const app = express();
const session = require('./middleware/session')(pool);
app.use(cors({origin:[...require('./middleware/session').origins],credentials:true}));
app.use(express.json());
app.use("/uploads", session.requireSession, async(req,res,next)=>{
  try{
    const route='/uploads'+decodeURIComponent(req.path);
    const rows=await pool.query(`SELECT r.id_reporte FROM archivo_reporte f JOIN reporte r USING(id_reporte)
      WHERE f.ruta_archivo=$1 AND r.activo AND
      (($2='CIUDADANO' AND r.id_usuario=$3) OR ($2='ENTIDAD' AND r.id_area_responsable=$4) OR $2='ADMIN')`,
      [route,req.user.rol,req.user.id_usuario,req.user.id_area_responsable]);
    if(!rows.rows.length)return res.sendStatus(404);
    res.set('Cache-Control','private, no-store');next();
  }catch{res.sendStatus(503);}
}, express.static(environment.uploads, {
  dotfiles: "deny", index: false,
  setHeaders(res) { res.setHeader("X-Content-Type-Options", "nosniff"); },
}));
app.use("/api", createApiRouter(pool, { uploadRoot: environment.uploads, session }));
app.use((req, res) => res.status(404).json({ ok: false, message: "Ruta no encontrada." }));
app.use((error, req, res, next) => {
  res.status(error.status === 400 ? 400 : 500).json({ ok: false, message: error.status === 400 ? "JSON no válido." : "Error interno del servidor." });
});

if (require.main === module) {
  const port = environment.port;
  const server = require("node:http").createServer(app);
  pool.query("SELECT current_database() AS database, current_user AS username").then(({ rows }) => {
    if (rows[0].database !== environment.database || rows[0].username !== environment.user) throw new Error("ISOLATION_FAILED");
    server.listen(port, "127.0.0.1", () => console.log(`PUNO REPORTA PRUEBAS: http://127.0.0.1:${port} · ${environment.database}`));
  }).catch(() => { console.error("No se pudo verificar la conexión aislada. Servidor detenido."); process.exitCode = 1; pool.end(); });
  server.on("error", error => {
    console.error("No se pudo iniciar la API:", error.code || "SERVER_ERROR");
    process.exitCode = 1;
    pool.end();
  });
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    server.close(() => pool.end().catch(() => { process.exitCode = 1; }));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = app;
