# Panel de entidad (entorno aislado)

Acceso desde `nueva-incidencia.html#entidad-vias` o `#entidad-limpieza`, en el servidor frontend existente. API en `http://127.0.0.1:3001`.

Se reutilizan las identidades de prueba 2 y 3; el servidor consulta su asignación activa en `usuario_area`. Los nombres y reportes proceden de PostgreSQL, filtrados por `reporte.id_area_responsable`, no por categoría ni por el ciudadano 1. Estos accesos NO son autenticación ni autorización de producción; permanecen limitados al entorno local de pruebas.

## Rutas nuevas

- `GET /api/entidad/:area/reportes`: área, reportes, archivos e historial. `area` solo admite `vias` o `limpieza`.
- `POST /api/entidad/:area/reportes/:id/estado`: JSON `{ "estado": "En proceso" }`.
- `POST /api/entidad/:area/reportes/:id/solucion`: multipart, `archivo` obligatorio y `observacion` opcional (máximo 4000 caracteres).

Las transiciones bloquean la fila dentro de una transacción. La solución guarda archivo SOLUCION, observación, fecha, estado e historial atribuido al usuario del área. Imágenes JPG/JPEG/PNG/WEBP, máximo 8 MB, en `backend/uploads-test/soluciones`. Se limpia el archivo nuevo si revierte la operación. Un reintento de la misma transición no duplica el historial ni la evidencia. GET /api/reportes del ciudadano obtiene el cambio al actualizar o volver a su panel.

## Permiso pendiente de autorización

La comprobación del 31/10/2026 detectó que `puno_reporta_test_app` no tiene UPDATE sobre `id_estado` y `fecha_actualizacion`. Por ello PostgreSQL rechaza la transición con 42501. No se ha concedido ningún privilegio ni se ha modificado el esquema.

Solo después de autorización, un propietario de la base puede ejecutar conectado a `puno_reporta_prueba_ia`:

```sql
SELECT current_database(), current_user;
-- Debe ser puno_reporta_prueba_ia; nunca ejecutar en puno_reporta.
GRANT UPDATE (id_estado, fecha_actualizacion)
ON public.reporte TO puno_reporta_test_app;
```

No requiere migraciones ni tablas. Una vez concedido, ejecutar `node --test backend/integration/entity-panel.test.cjs`. La prueba usa transacción exterior y revierte sus registros temporales; elimina únicamente su subcarpeta de evidencias, sin alterar reportes históricos.

## Verificación

`node --test tests/*.test.cjs backend/tests/*.test.cjs`

`node tests/entity-panel-browser.cjs` comprueba consultas reales, filtros, paginación, detalle, errores de conexión y cinco resoluciones. No cambia los estados de reportes históricos.

Perfil y Reporte estadístico quedan visibles pero deshabilitados: no se han creado módulos ni estadísticas ficticias. No se muestran notificaciones ni datos personales del ciudadano que no estén soportados por la API.
