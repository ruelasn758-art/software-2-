"use strict";

const { Router } = require("express");

module.exports = function createApiRouter(pool, { uploadRoot, session = require('../middleware/session')(pool) } = {}) {
  const router = Router();
  router.use(session.origin);
  router.use('/auth', require('./auth')(pool, session));
  router.get('/admin/session', session.requireSession, session.allow('ADMIN'), (req,res)=>res.json({ok:true,usuario:req.user}));
  router.use("/entidad", session.requireSession, session.allow('ENTIDAD'), require("./entidad")(pool, uploadRoot));
  router.use('/reportes', session.requireSession, session.allow('CIUDADANO'));
  const reportes = require("../controllers/reportes")(pool);
  router.get("/reportes", reportes.list);
  router.post("/reportes", require("../middleware/report-idempotency")(), reportes.create);
  router.post("/reportes/:id_reporte/archivos", async(req,res,next)=>{
    if(!/^[1-9]\d*$/.test(req.params.id_reporte))return res.status(400).json({ok:false,message:'Reporte no válido.'});
    try {
      const owned=await pool.query('SELECT id_reporte FROM reporte WHERE id_reporte=$1 AND id_usuario=$2 AND activo',[req.params.id_reporte,req.user.id_usuario]);
      if(!owned.rows.length)return res.status(404).json({ok:false,message:'Reporte no disponible.'});
      next();
    }catch{res.status(503).json({ok:false,message:'No se pudo verificar el reporte.'});}
  }, ...require("../controllers/archivos")(pool, uploadRoot));
  router.get("/tipos-incidencia", reportes.types);
  router.get("/destinos", async (req, res) => {
    try {
      const category = req.query.categoria == null ? null : require("../services/reportes").id(req.query.categoria, "categoria");
      res.json(await require("../services/destinos").getDestinations(pool, category));
    } catch (error) {
      res.status(error.status || 500).json({ok:false,message:error.status ? error.message : "No se pudieron cargar los destinos."});
    }
  });
  router.use("/ia", session.requireSession, session.allow('CIUDADANO'), require("./vision")(pool));

  router.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT NOW();");
      res.json({ ok: true, message: "PUNO REPORTA API conectada correctamente", database: pool.options.database });
    } catch (error) {
      console.error("No se pudo comprobar PostgreSQL:", error.code || "DB_ERROR");
      res.status(503).json({ ok: false, message: "No se pudo conectar con PostgreSQL. Revisa la configuración del backend." });
    }
  });

  router.get("/categorias", async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT id_categoria, nombre, descripcion
FROM categoria
WHERE activo = TRUE
ORDER BY id_categoria;`);
      res.json(rows);
    } catch (error) {
      console.error("No se pudieron consultar las categorías:", error.code || "DB_ERROR");
      res.status(500).json({ ok: false, message: "No se pudieron consultar las categorías." });
    }
  });

  return router;
};
