# Fotografía inicial del reporte

Reinicia la API con `npm start` desde `backend/`. El formulario envía primero
el reporte y después su fotografía; solo muestra confirmación cuando ambos
han sido registrados. No se ha cambiado el esquema de PostgreSQL.

- Endpoint: `POST /api/reportes/:id_reporte/archivos`.
- Multipart: un archivo `archivo`, `tipo_archivo=INCIDENCIA`; `descripcion` opcional.
- JPG/JPEG, PNG y WEBP, máximo 8 MB. Se verifican extensión, MIME y firma binaria.
- Archivos físicos: `backend/uploads/incidencias/`, nombres generados con UUID.
- `archivo_reporte` almacena la ruta pública, no el contenido binario.
- Reintentar sobre un reporte con fotografía inicial devuelve la ya registrada (200),
  sin reemplazarla ni duplicarla. Una primera subida responde 201.
- Si falla el INSERT se revierte la transacción y se elimina el archivo nuevo.

## Prueba desde PowerShell

Utiliza el ID de un reporte existente que todavía no tenga fotografía inicial:

```powershell
curl.exe -X POST "http://localhost:3000/api/reportes/123/archivos" -F "tipo_archivo=INCIDENCIA" -F "archivo=@C:\Fotos\incidente.jpg"
```

Sustituye `123` y la ruta de la fotografía. La respuesta incluye `archivo.ruta_archivo`.
Abre `http://localhost:3000` seguido de esa ruta para ver la imagen.

```sql
SELECT id_archivo, id_reporte, tipo_archivo, ruta_archivo,
       nombre_original, descripcion, fecha_registro
FROM archivo_reporte
WHERE id_reporte = 123
ORDER BY id_archivo;
```

## Prueba del formulario

En Nueva incidencia, elige categoría, tipo, fotografía y confirma la ubicación.
En DevTools / Network deben aparecer dos POST: `/api/reportes` y luego
`/api/reportes/ID/archivos`, este último con FormData. Console muestra el ID,
nombre de archivo y respuesta. No establecemos Content-Type manualmente: el
navegador agrega el boundary multipart.

Si falla la foto, se conserva en memoria el reporte creado y su fotografía.
El botón cambia a «Reintentar subir foto» y reutiliza el mismo ID. Mantén la
página abierta hasta terminar; se avisa al intentar cerrarla o recargarla.
El respaldo local existente se genera después de completar ambos pasos e
incluye también los metadatos del archivo remoto. Esta etapa no implementa
recuperación del formulario pendiente después de cerrar la pestaña.

Pruebas automáticas (sin insertar datos en la base real):
`npm test` desde backend y `node --test tests/*.test.cjs` desde la raíz.
