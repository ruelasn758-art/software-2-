# Backend inicial de PUNO REPORTA

Esta API conserva el frontend, localStorage y el esquema PostgreSQL. Incluye consultas de lectura y registro de reportes con historial en una transacción. No implementa autenticación, archivos ni IA.

## Configuración

Desde PowerShell:

```powershell
cd "D:\Software II\backend"
Copy-Item .env.example .env
```

Editar `.env` y reemplazar `CAMBIAR_CONTRASENA` por la contraseña real del usuario PostgreSQL. Si contiene `#` o espacios, poner el valor completo entre comillas dobles. No compartir este archivo; está excluido mediante `.gitignore`.

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_NAME=puno_reporta
DB_USER=postgres
DB_PASSWORD=CAMBIAR_CONTRASENA
PORT=3000
```

## Ejecutar

```powershell
npm start
```

- `http://localhost:3000/api/health`: ejecuta `SELECT NOW();`. Solo devuelve `ok: true` si PostgreSQL respondió. Si falla, devuelve HTTP 503.
- `http://localhost:3000/api/categorias`: devuelve un arreglo JSON con `id_categoria`, `nombre` y `descripcion` de las categorías activas, ordenadas por id. Si no hay categorías activas, devuelve `[]`; si la consulta falla, devuelve HTTP 500.

PostgreSQL debe estar ejecutándose y aceptar las credenciales configuradas. La tabla `categoria` debe estar disponible en el search_path del usuario y tener las columnas solicitadas. No se han creado migraciones ni alterado el esquema. El puerto 3000 es independiente del servidor de vista previa del frontend (4173). Detener con Ctrl+C.

## Verificación

`npm test` verifica las rutas con un Pool simulado, incluyendo fallos. No demuestra una conexión real: esa comprobación se realiza abriendo ambos endpoints después de configurar `.env`.

Dependencias directas: express, pg, dotenv y cors. `package-lock.json` fija las versiones instaladas; para reinstalar usar `npm ci`. Controllers y services contienen la gestión de reportes; middleware y uploads siguen reservadas.

## Tipos y registro real de reportes

Reiniciar `npm start` si el servidor ya estaba ejecutándose. Consultar los tipos activos de una categoría:

```powershell
Invoke-RestMethod "http://localhost:3000/api/tipos-incidencia?categoria=1"
```

La categoría debe ser un ID positivo; si no tiene tipos activos devuelve `[]`. Para crear un reporte, sustituir los IDs de ejemplo por un usuario activo y un tipo que corresponda a la categoría:

```powershell
$body = @{
  id_usuario = 1
  id_categoria = 1
  id_tipo_incidencia = 1
  descripcion = "Bache en la vía pública"
  latitud = -15.8402
  longitud = -70.0219
  origen_ubicacion = "GPS"
  precision_metros = 8.5
} | ConvertTo-Json

$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/reportes" `
  -Method Post -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$respuesta | ConvertTo-Json -Depth 5
```

Devuelve HTTP 201 con `ok`, `message` y `reporte` (id, código, estado Reportado y área asignada). Los IDs bigint se devuelven como texto para conservar su precisión. Cada petición válida crea un reporte nuevo.

Validaciones: IDs positivos dentro del rango bigint, usuario activo, tipo activo de la categoría activa, latitud entre -90 y 90, longitud entre -180 y 180, origen GPS/MANUAL. Descripción y precisión son opcionales. La precisión, si se envía, debe estar entre 0 y 999999.99 (numeric(8,2) existente). No se aceptan `codigo`, `id_estado` ni `id_area_responsable` del cliente.

El área se obtiene de las asignaciones y áreas activas, usando menor `prioridad` numérica primero y menor id de área como desempate. Se exige un único estado activo llamado Reportado. Si falta esa configuración, responde 409. Datos inválidos o tipo ajeno responden 400; errores internos devuelven un mensaje genérico sin credenciales ni SQL.

El código usa fecha/hora UTC y 10 caracteres hexadecimales aleatorios, dentro del límite existente de 30 caracteres. La restricción UNIQUE de PostgreSQL evita duplicados; ante colisión se reintenta hasta tres veces. La ubicación usa longitud primero. `BEGIN`, inserciones y `COMMIT`/`ROLLBACK` comparten un solo cliente; cualquier fallo del historial revierte también el reporte.

Comprobar en PostgreSQL, sustituyendo `2` por el id devuelto:

```sql
SELECT r.id_reporte, r.codigo, r.id_usuario, r.id_categoria,
       r.id_tipo_incidencia, r.id_area_responsable, e.nombre AS estado,
       ST_X(r.ubicacion::geometry) AS longitud,
       ST_Y(r.ubicacion::geometry) AS latitud,
       r.origen_ubicacion, r.precision_metros, r.fecha_registro
FROM reporte r JOIN estado_reporte e ON e.id_estado = r.id_estado
WHERE r.id_reporte = 2;

SELECT id_reporte, id_estado_anterior, id_estado_nuevo, id_usuario, observacion
FROM historial_estado WHERE id_reporte = 2;
```

Debe existir un reporte y su primer historial, con estado anterior NULL, nuevo estado Reportado y observación «Reporte registrado por el ciudadano». Se verificaron las inserciones reales y las coordenadas en una transacción de prueba revertida: no se dejó un reporte de prueba guardado. Las secuencias identity pueden tener saltos tras un rollback; es normal.

Referencias de implementación: [transacciones con el mismo cliente](https://node-postgres.com/features/transactions) y [ST_MakePoint](https://postgis.net/docs/ST_MakePoint.html).

Referencias: [Pool de node-postgres](https://node-postgres.com/features/pooling) y [Express](https://expressjs.com/en/starter/installing.html).
