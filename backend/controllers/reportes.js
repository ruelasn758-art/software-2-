"use strict";

const { id, validate, createReport, listReports } = require("../services/reportes");

module.exports = function reportesController(pool) {
  function fail(res, error) {
    if (error.status) return res.status(error.status).json({ ok: false, message: error.message });
    if (["23503", "23514", "22003", "22P02"].includes(error.code)) return res.status(400).json({ ok: false, message: "Los datos del reporte no son válidos o una referencia ya no existe." });
    console.error("Error al gestionar reportes:", error.code || "DB_ERROR");
    return res.status(500).json({ ok: false, message: "No se pudo completar la operación con PostgreSQL." });
  }
  return {
    async list(req, res) {
      try {
        if (req.query.id_usuario !== undefined && String(req.query.id_usuario) !== String(req.user.id_usuario)) {
          return res.status(403).json({ ok: false, message: "Solo puedes consultar tus propios reportes." });
        }
        res.set("Cache-Control", "no-store");
        res.json(await listReports(pool, null, req.user.id_usuario));
      } catch (error) { fail(res, error); }
    },
    async create(req, res) {
      try {
        const input = validate({...req.body, id_usuario:req.user.id_usuario});
        const reporte = await createReport(pool, input);
        res.status(201).json({ ok: true, message: "Reporte registrado correctamente", reporte });
      } catch (error) { fail(res, error); }
    },
    async types(req, res) {
      try {
        const category = id(req.query.categoria, "categoria");
        const { rows } = await pool.query(`SELECT id_tipo_incidencia, nombre FROM tipo_incidencia
WHERE id_categoria = $1 AND activo = TRUE ORDER BY id_tipo_incidencia`, [category]);
        res.json(rows);
      } catch (error) { fail(res, error); }
    },
  };
};
