# Etapa aislada: categoría obligatoria y tipo opcional

Esta versión solo arranca con `puno_reporta_prueba_ia`, usuario
`puno_reporta_test_app` y puerto 3001. Lee `.env.test`; no lee `.env`.
Las credenciales ya fueron provisionadas localmente, sin mostrarlas en consola.
No copiar la contraseña de postgres al entorno de pruebas.

El usuario no es superusuario, no crea bases ni roles y no tiene permisos
de escritura sobre las tablas de `puno_reporta`. En la copia tiene lectura,
inserción en reporte/historial/archivo y los permisos de actualización mínimos
necesarios para el bloqueo del reporte y reparación del archivo.
No se crearon tablas ni se ejecutaron migraciones adicionales.

## Abrir

Terminal 1:
```powershell
cd "D:\Software II\backend"
npm start
```

Terminal 2:
```powershell
cd "D:\Software II"
node scripts/preview.cjs
```

Frontend: http://127.0.0.1:4174/nueva-incidencia.html

API: http://127.0.0.1:3001/api/health

La respuesta de salud debe indicar `puno_reporta_prueba_ia`.
El frontend usa exclusivamente el puerto 3001, sin fallback a 3000.
El puerto 4174 separa también el localStorage del antiguo puerto 4173.
Las fotografías nuevas se guardan en `backend/uploads-test/incidencias/`.
No se copian ni modifican las fotografías originales de `backend/uploads/`.

## Formulario único

Categoría, foto y ubicación confirmada son obligatorias. El tipo se puede
seleccionar o dejar en «Sin especificar (opcional)». Una carga fallida o vacía
de tipos no bloquea el registro por categoría. Cambiar categoría limpia el tipo.
La descripción continúa opcional y editable. No se implementó IA ni se insertan
filas en clasificacion_ia. Los controles siguen preparados para recibir valores
editables en una etapa futura.

La API admite tipo omitido o null. Un tipo presente debe ser válido, activo y
pertenecer a la categoría activa. Rechaza cadenas vacías, cero y tipos ajenos.
El área sigue determinándose con categoria_area y area_entidad; una prioridad
ganadora ambigua se rechaza. La asignación local visual existente se conserva.

## Pruebas

```powershell
node --test tests/*.test.cjs
npm --prefix backend test
npm --prefix backend run test:integration
```

La integración usa credenciales restringidas, puerto HTTP efímero, carpeta
temporal dentro de uploads-test y una transacción exterior con SAVEPOINT.
Todas las filas de prueba se revierten y sus imágenes se eliminan.
Las secuencias de IDs de la copia pueden avanzar aunque se reviertan las filas.
No se cambian históricos. Una prueba inspecciona únicamente los permisos del
usuario en la principal, con conexión explícitamente de solo lectura.

Las pruebas de frontend utilizan un DOM simulado: no sustituyen una revisión
visual en navegador. Los registros que envíes manualmente desde la interfaz
sí permanecerán en la base de pruebas.

No arrancar un backend antiguo en 3001 ni cambiar la configuración hacia la
principal. `config/test-environment.js` rechaza otra base, usuario o puerto y
el servidor verifica current_database/current_user antes de escuchar.

Esta etapa no migra la principal ni implementa IA. El .env original queda
intacto para una futura decisión explícita de despliegue.


## Mis reportes y dashboard desde PostgreSQL

GET http://127.0.0.1:3001/api/reportes devuelve un arreglo de reportes activos del
usuario de prueba 1. Tambi?n admite ?id_usuario=1; otro usuario se rechaza con 403.
El usuario est? fijado en el servidor, no se toma de la sesi?n simulada.
Este filtro NO sustituye autenticaci?n ni autorizaci?n real y no debe desplegarse
como un sistema multiusuario. La consulta usa par?metros, LEFT JOIN para el tipo
opcional y la relaci?n archivo_reporte para las im?genes. No cambia datos.

Mis reportes y el dashboard consultan esta ruta al abrirse y con Actualizar reportes.
Una respuesta correcta reemplaza el arreglo visible y actualiza localStorage como
cach?; no mezcla registros simulados con PostgreSQL. Si la API falla se muestra
una advertencia y el respaldo disponible. Una lista vac?a v?lida no usa respaldo.
Ver detalle utiliza el mismo objeto consultado, sin pedir GPS ni inventar datos.
Las URLs de fotograf?as apuntan exclusivamente a /uploads en el puerto 3001.
Los archivos hist?ricos ausentes se indican en el detalle; no se copian del entorno
principal. La gesti?n de estados de entidades sigue siendo simulada: esta etapa
no a?ade endpoints de actualizaci?n de estado y una nueva consulta prevalece
sobre cambios locales.

Para probar:
1. Reiniciar npm start en backend si hab?a un proceso anterior.
2. Abrir /api/health y comprobar puno_reporta_prueba_ia, luego /api/reportes.
3. Abrir http://127.0.0.1:4174/nueva-incidencia.html#inicio y entrar en Mis reportes.
4. Comprobar c?digos, estados, fotos y Ver detalle de los IDs 11, 12 y 13.
5. Registrar un reporte con tipo vac?o y foto; Ver mis reportes debe incluirlo.
6. En Network comprobar GET reportes?id_usuario=1 y las im?genes con respuesta 200.
7. Detener la API y pulsar Actualizar reportes: debe informar que usa respaldo.
   Reiniciar y actualizar para volver a los datos reales.

Pruebas: tests/incidence.test.cjs cubre lista, detalle, fotograf?a, cach?, carga,
error, vac?o y navegaci?n durante consultas. backend/integration/report-list.test.cjs
comprueba el conjunto real del usuario 1 y descarga las fotograf?as de 11/12/13.
La prueba de creaci?n reversible tambi?n comprueba que GET incluye cada reporte
reci?n creado con tipo opcional y la fotograf?a subida.
