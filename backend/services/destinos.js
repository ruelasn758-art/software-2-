"use strict";

async function getDestinations(pool, category) {
  const { rows } = await pool.query(`SELECT a.id_area, a.nombre AS area, a.descripcion,
    e.id_entidad, e.nombre AS entidad,
    (SELECT min(ca.prioridad) FROM categoria_area ca WHERE ca.id_area=a.id_area
      AND ca.id_categoria=$1 AND ca.activo=TRUE) AS prioridad
    FROM area_entidad a JOIN entidad e ON e.id_entidad=a.id_entidad
    WHERE a.activo=TRUE AND e.activo=TRUE AND EXISTS
      (SELECT 1 FROM categoria_area ca JOIN categoria c ON c.id_categoria=ca.id_categoria
       WHERE ca.id_area=a.id_area AND ca.activo=TRUE AND c.activo=TRUE)
    ORDER BY prioridad ASC NULLS LAST, e.nombre, a.nombre`, [category]);
  const ranked = rows.filter(r => r.prioridad !== null);
  const recommended = ranked.length && !(ranked.length > 1 && ranked[0].prioridad === ranked[1].prioridad) ? ranked[0].id_area : null;
  return { destinos: rows, id_area_recomendada: recommended };
}

async function validateDestination(client, area) {
  const { rows } = await client.query(`SELECT a.id_area, a.nombre AS area, e.nombre AS entidad
    FROM area_entidad a JOIN entidad e ON e.id_entidad=a.id_entidad
    WHERE a.id_area=$1 AND a.activo=TRUE AND e.activo=TRUE AND EXISTS
      (SELECT 1 FROM categoria_area ca JOIN categoria c ON c.id_categoria=ca.id_categoria
       WHERE ca.id_area=a.id_area AND ca.activo=TRUE AND c.activo=TRUE)`, [area]);
  if (!rows.length) throw Object.assign(new Error("El destino seleccionado no está habilitado para recibir reportes."), { status: 400 });
  return rows[0];
}
module.exports = { getDestinations, validateDestination };
