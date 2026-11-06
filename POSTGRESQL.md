# Base de datos de Puno Reporta

El software utiliza PostgreSQL cuando existe `private/postgres/conexion.json`.
Esa configuración contiene un usuario de servicio propio, sin permisos de
administración del servidor. No compartir ni subir la carpeta `private` a GitHub.

## Ver las tablas

1. Abrir pgAdmin e ingresar al servidor PostgreSQL 18.
2. Expandir Databases → puno_reporta → Schemas → public → Tables.
3. Si no aparece, hacer clic derecho en Databases y seleccionar Refresh.
4. Para ver registros: clic derecho en una tabla → View/Edit Data → All Rows.

Las 16 tablas solicitadas son: rol, entidad, categoria, estado_reporte, usuario,
area_entidad, tipo_incidencia, usuario_area, categoria_area, reporte,
archivo_reporte, clasificacion_ia, historial_estado, comentario_reporte,
notificacion y auditoria. PostGIS añade su tabla técnica `spatial_ref_sys` para
las coordenadas geográficas; no es una tabla adicional de funcionalidades.

## Integración y datos conservados

Los datos anteriores se copiaron desde SQLite. Sus archivos de fotos siguen en
las carpetas existentes. El archivo SQLite original y su copia en
`private/postgres/respaldo-sqlite-*.db` se conservan, pero no reciben los nuevos
registros de PostgreSQL.

El esquema `compat` contiene vistas que conectan las consultas existentes con
las nuevas tablas. No son copias de los datos. Se añadieron columnas para
conservar nombre de usuario, verificación de DNI, referencias, recuperación de
cuentas y avisos. Los correos que no existían se identifican mediante direcciones
técnicas `@puno.invalid`; no son direcciones reales ni sirven para enviar correo.

Los cambios de estado generan historial y las escrituras principales generan
auditoría automáticamente. Los reportes antiguos solo conservan su estado
conocido: no se inventó un historial anterior.

La interfaz existente clasifica en cuatro categorías. Para satisfacer la relación
obligatoria con tipo_incidencia, la integración usa el primer tipo del catálogo
de la categoría; esto es una equivalencia inicial, no una detección del subtipo.
La aplicación anterior no almacenaba el origen ni la precisión de la ubicación:
el origen de estos reportes queda como MANUAL y la precisión sin valor.

Las tablas comentario_reporte y clasificacion_ia están creadas y relacionadas,
pero las pantallas actuales no guardan comentarios ni resultados detallados del
modelo. No se añadieron esas funciones ni nuevas pantallas en esta migración.
Los cuatro roles están en el catálogo; se mantienen los permisos de los tres
roles que ya utilizaba la aplicación. No se añadió una pantalla de administración
por entidad.

## Iniciar y comprobar

Cerrar una instancia anterior de la aplicación y abrir `iniciar.bat`, o usar
`iniciar_movil.bat` para el acceso móvil habitual. PostgreSQL debe estar iniciado.
Si falla una conexión configurada, el software muestra el error y no cambia
silenciosamente a SQLite.

`tests/verificar_postgres.py` comprueba los flujos en una base desechable creada desde cero (ver README), que
elimina al terminar. `database/01_tablas.sql` contiene las tablas solicitadas;
`database/02_integracion.sql`, las vistas y reglas de integración.
No repetir `database/migrar_postgres.py` en la base ya migrada: el script se
detiene para evitar sobrescribir datos.
