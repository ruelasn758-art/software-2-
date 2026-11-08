"use strict";

const multer = require("multer");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { id } = require("../services/reportes");
const uploadRoot = path.join(__dirname, "../uploads-test");
const allowed = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const fail = (status, message) => Object.assign(new Error(message), { status });
const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2, parts: 3, fieldSize: 4096 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(allowed[ext] === file.mimetype ? null : fail(415, "Selecciona una imagen JPG, JPEG, PNG o WEBP."), allowed[ext] === file.mimetype);
  },
}).single("archivo");

function validSignature(file) {
  const b = file.buffer;
  if (file.mimetype === "image/jpeg") return b.length > 3 && b.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (file.mimetype === "image/png") return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
}

async function storedFileExists(root, storedPath) {
  if (typeof storedPath !== "string" || !storedPath.startsWith("/uploads/")) return false;
  const base = path.resolve(root);
  const candidate = path.resolve(base, storedPath.slice("/uploads/".length));
  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!inside(base, candidate)) return false;
  try {
    // También evita aceptar enlaces que apunten fuera de uploads.
    const [realBase, realFile] = await Promise.all([fs.realpath(base), fs.realpath(candidate)]);
    return inside(realBase, realFile) && (await fs.stat(realFile)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error; // Un error de permisos no significa que el archivo esté ausente.
  }
}

module.exports = function createArchivoHandlers(pool, root = uploadRoot) {
  return [async (req, res, next) => {
    try {
      req.reportId = id(req.params.id_reporte, "id_reporte");
      const found = await pool.query("SELECT id_reporte FROM reporte WHERE id_reporte = $1", [req.reportId]);
      if (!found.rows.length) throw fail(404, "El reporte no existe.");
      next();
    } catch (error) { respond(error, res); }
  }, (req, res) => receive(req, res, async error => {
    if (error) return respond(error, res);
    let client, filename, transaction = false, createdFile = false;
    try {
      if (req.body.tipo_archivo !== "INCIDENCIA") throw fail(400, "tipo_archivo debe ser INCIDENCIA.");
      if (!req.file || !validSignature(req.file)) throw fail(400, "Adjunta una fotografía válida del incidente.");
      client = await pool.connect();
      await client.query("BEGIN"); transaction = true;
      const locked = await client.query("SELECT id_reporte FROM reporte WHERE id_reporte = $1 FOR UPDATE", [req.reportId]);
      if (!locked.rows.length) throw fail(404, "El reporte no existe.");
      // Un reintento tras perder la respuesta no crea otra fotografía inicial.
      const previous = await client.query("SELECT * FROM archivo_reporte WHERE id_reporte = $1 AND tipo_archivo = 'INCIDENCIA' ORDER BY id_archivo LIMIT 1", [req.reportId]);
      let archivo = previous.rows[0];
      if (!archivo || !await storedFileExists(root, archivo.ruta_archivo)) {
        const relative = `incidencias/PR-${req.reportId}-${randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`;
        await fs.mkdir(path.join(root, "incidencias"), { recursive: true });
        filename = path.join(root, relative);
        const file = await fs.open(filename, "wx");
        createdFile = true;
        try { await file.writeFile(req.file.buffer); } finally { await file.close(); }
        const saved = await fs.stat(filename);
        if (!saved.isFile() || saved.size !== req.file.buffer.length) throw new Error("UPLOAD_WRITE_INCOMPLETE");
        const metadata = [`/uploads/${relative}`, path.basename(req.file.originalname).slice(0, 255), req.body.descripcion || null];
        const result = archivo
          ? await client.query(`UPDATE archivo_reporte
          SET ruta_archivo = $1, nombre_original = $2, descripcion = $3
          WHERE id_archivo = $4 AND id_reporte = $5 AND tipo_archivo = 'INCIDENCIA'
          RETURNING *`, [...metadata, archivo.id_archivo, req.reportId])
          : await client.query(`INSERT INTO archivo_reporte
          (id_reporte, tipo_archivo, ruta_archivo, nombre_original, descripcion)
          VALUES ($1, 'INCIDENCIA', $2, $3, $4) RETURNING *`,
        [req.reportId, ...metadata]);
        if (!result.rows.length) throw new Error("UPLOAD_RECORD_NOT_SAVED");
        archivo = result.rows[0];
      }
      await client.query("COMMIT"); transaction = false;
      res.status(previous.rows.length ? 200 : 201).json({ ok: true, message: "Fotografía registrada correctamente", archivo });
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => {});
      if (createdFile) await fs.unlink(filename).catch(cleanupError => {
        if (cleanupError.code !== "ENOENT") console.error("No se pudo limpiar la fotografía nueva:", cleanupError.code || "CLEANUP_ERROR");
      });
      respond(error, res);
    } finally { if (client) client.release(); }
  })];
};

function respond(error, res) {
  const tooLarge = error.code === "LIMIT_FILE_SIZE";
  const status = tooLarge ? 413 : error instanceof multer.MulterError ? 400 : error.status || 500;
  if (status >= 500) console.error("Error al guardar fotografía:", error.code || "UPLOAD_ERROR");
  res.status(status).json({ ok: false, message: tooLarge ? "La fotografía no debe superar 8 MB."
    : error instanceof multer.MulterError ? "Envía una sola fotografía en el campo archivo."
    : status < 500 ? error.message : "No se pudo guardar la fotografía. Inténtalo nuevamente." });
}

// Validaciones compartidas por la evidencia de solución, sin alterar la foto inicial.
module.exports.receive = receive;
module.exports.validSignature = validSignature;
module.exports.storedFileExists = storedFileExists;
