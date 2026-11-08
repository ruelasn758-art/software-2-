"use strict";

const { randomBytes } = require("node:crypto");

function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
function id(value, field) {
  const text = typeof value === "string" ? value : Number.isSafeInteger(value) ? String(value) : "";
  if (!/^[1-9]\d*$/.test(text) || BigInt(text) > 9223372036854775807n) throw invalid(`${field} debe ser un identificador positivo válido.`);
  return text;
}
function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("Se requiere un objeto JSON.");
  for (const field of ["id_estado", "id_area_responsable", "codigo"]) {
    if (Object.hasOwn(body, field)) throw invalid(`${field} lo asigna el backend; no debe enviarse.`);
  }
  const input = {};
  for (const field of ["id_usuario", "id_categoria"]) input[field] = id(body[field], field);
  input.id_tipo_incidencia = body.id_tipo_incidencia == null ? null : id(body.id_tipo_incidencia, "id_tipo_incidencia");
  input.id_area_destino = body.id_area_destino == null ? null : id(body.id_area_destino, "id_area_destino");
  for (const [field, limit] of [["latitud", 90], ["longitud", 180]]) {
    if (typeof body[field] !== "number" || !Number.isFinite(body[field]) || Math.abs(body[field]) > limit) throw invalid(`${field} debe ser un número entre -${limit} y ${limit}.`);
    input[field] = body[field];
  }
  if (!["GPS", "MANUAL"].includes(body.origen_ubicacion)) throw invalid("origen_ubicacion debe ser GPS o MANUAL.");
  input.origen_ubicacion = body.origen_ubicacion;
  if (body.descripcion != null && typeof body.descripcion !== "string") throw invalid("descripcion debe ser texto.");
  input.descripcion = body.descripcion?.trim() || null;
  const precision = body.precision_metros ?? null;
  if (precision !== null && (typeof precision !== "number" || !Number.isFinite(precision) || precision < 0 || precision > 999999.99)) throw invalid("precision_metros debe ser un número entre 0 y 999999.99.");
  input.precision_metros = precision;
  return input;
}
function generateCode() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "");
  return `PR-${stamp.slice(0, 8)}-${stamp.slice(9, 15)}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

async function createReport(pool, input) {
  const client = await pool.connect();
  let transaction = false;
  let releaseError;
  try {
    await client.query("BEGIN");
    transaction = true;
    const user = await client.query("SELECT id_usuario FROM usuario WHERE id_usuario = $1 AND activo = TRUE", [input.id_usuario]);
    if (!user.rows.length) throw invalid("El usuario no existe o está inactivo.");
    const category = await client.query("SELECT id_categoria FROM categoria WHERE id_categoria = $1 AND activo = TRUE", [input.id_categoria]);
    if (!category.rows.length) throw invalid("La categoría no existe o no está activa.");
    if (input.id_tipo_incidencia !== null) {
      const type = await client.query(`SELECT t.id_tipo_incidencia FROM tipo_incidencia t
JOIN categoria c ON c.id_categoria = t.id_categoria
WHERE t.id_tipo_incidencia = $1 AND t.id_categoria = $2 AND t.activo = TRUE AND c.activo = TRUE`, [input.id_tipo_incidencia, input.id_categoria]);
      if (!type.rows.length) throw invalid("El tipo de incidencia no pertenece a la categoría o no está activo.");
    }
    let area;
    let destination;
    if (input.id_area_destino) {
      destination = await require("./destinos").validateDestination(client, input.id_area_destino);
      area = destination.id_area;
    } else {
    const areas = await client.query(`SELECT ca.id_area, ca.prioridad FROM categoria_area ca
JOIN area_entidad a ON a.id_area = ca.id_area
JOIN entidad e ON e.id_entidad = a.id_entidad
WHERE ca.id_categoria = $1 AND ca.activo = TRUE AND a.activo = TRUE AND e.activo = TRUE
ORDER BY ca.prioridad ASC, ca.id_area ASC`, [input.id_categoria]);
    if (!areas.rows.length) throw invalid("La categoría no tiene un área responsable activa asignada.", 409);
    if (areas.rows.some(row => row.prioridad == null) ||
        areas.rows.length > 1 && areas.rows[0].prioridad === areas.rows[1].prioridad) {
      throw invalid("La categoría tiene una asignación de área ambigua. Revisa su configuración.", 409);
    }
    area = areas.rows[0].id_area;
    }
    const states = await client.query("SELECT id_estado FROM estado_reporte WHERE nombre = $1 AND activo = TRUE", ["Reportado"]);
    if (states.rows.length !== 1) throw invalid("Debe existir un único estado activo llamado Reportado.", 409);
    const state = states.rows[0].id_estado;
    let report;
    for (let attempt = 0; attempt < 3 && !report; attempt += 1) {
      const result = await client.query(`INSERT INTO reporte
(codigo, id_usuario, id_categoria, id_tipo_incidencia, id_area_responsable, id_estado,
 descripcion, ubicacion, origen_ubicacion, precision_metros)
VALUES ($1, $2, $3, $4, $5, $6, $7,
 ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography, $10, $11)
ON CONFLICT (codigo) DO NOTHING
RETURNING id_reporte, codigo, id_area_responsable`, [
        generateCode(), input.id_usuario, input.id_categoria, input.id_tipo_incidencia, area, state,
        input.descripcion, input.longitud, input.latitud, input.origen_ubicacion, input.precision_metros,
      ]);
      report = result.rows[0];
    }
    if (!report) throw invalid("No se pudo generar un código único. Inténtalo nuevamente.", 503);
    await client.query(`INSERT INTO historial_estado
(id_reporte, id_estado_anterior, id_estado_nuevo, id_usuario, observacion)
VALUES ($1, NULL, $2, $3, $4)`, [report.id_reporte, state, input.id_usuario, "Reporte registrado por el ciudadano"]);
    await client.query("COMMIT");
    transaction = false;
    return { ...report, estado: "Reportado", ...(destination ? { area_responsable: destination.area, entidad: destination.entidad } : {}) };
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) { releaseError = rollbackError; }
    }
    throw error;
  } finally { client.release(releaseError); }
}

// El llamador obtiene la identidad de la sesión, nunca del navegador.
async function listReports(pool, areaId = null, userId) {
  const { rows } = await pool.query(`SELECT r.id_reporte, r.codigo, r.id_usuario,
    r.id_categoria, c.nombre AS categoria, r.id_tipo_incidencia, t.nombre AS tipo_incidencia,
    r.descripcion, e.nombre AS estado, r.fecha_registro AT TIME ZONE 'America/Lima' AS fecha_registro,
    ST_Y(r.ubicacion::geometry) AS latitud, ST_X(r.ubicacion::geometry) AS longitud,
    r.origen_ubicacion, r.precision_metros, r.id_area_responsable, a.nombre AS area_responsable,
    COALESCE((SELECT json_agg(f ORDER BY f.fecha_registro, f.id_archivo)
      FROM (SELECT id_archivo, tipo_archivo, ruta_archivo, nombre_original, descripcion, fecha_registro
        FROM archivo_reporte WHERE id_reporte = r.id_reporte) f), '[]'::json) AS archivos,
    COALESCE((SELECT json_agg(h ORDER BY h.fecha_cambio,h.id_historial)
      FROM (SELECT he.id_historial, en.nombre AS estado, he.observacion,
        he.fecha_cambio AT TIME ZONE 'America/Lima' AS fecha_cambio
        FROM historial_estado he JOIN estado_reporte en ON en.id_estado=he.id_estado_nuevo
        WHERE he.id_reporte=r.id_reporte) h), '[]'::json) AS historial
    FROM reporte r
    JOIN categoria c ON c.id_categoria = r.id_categoria
    LEFT JOIN tipo_incidencia t ON t.id_tipo_incidencia = r.id_tipo_incidencia
    JOIN estado_reporte e ON e.id_estado = r.id_estado
    LEFT JOIN area_entidad a ON a.id_area = r.id_area_responsable
    WHERE ${areaId === null ? "r.id_usuario" : "r.id_area_responsable"} = $1 AND r.activo = TRUE
    ORDER BY r.fecha_registro DESC, r.id_reporte DESC`, [areaId === null ? id(userId,'usuario') : id(areaId,"area")]);
  return rows;
}

module.exports = { id, validate, createReport, generateCode, listReports };
