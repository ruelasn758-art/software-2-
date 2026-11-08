# Autenticación por roles — entorno aislado

Implementación exclusiva para `puno_reporta_prueba_ia`, usuario PostgreSQL `puno_reporta_test_app`, API `http://127.0.0.1:3001/api` y vista previa `http://127.0.0.1:4174`.

## Acceso

Un único formulario `iniciar-sesion.html`. El registro público en `crear-cuenta.html` crea solamente ciudadanos. Nombre completo, correo y contraseña de 12 a 128 caracteres; sin selector de rol o área. El backend valida también estos requisitos.

Roles consultados por nombre, sin fijar sus IDs:

| Nombre existente en rol | Permiso de aplicación | Destino |
|---|---|---|
| Ciudadano | CIUDADANO | nueva-incidencia.html#inicio |
| Trabajador | ENTIDAD | nueva-incidencia.html#entidad |
| Administrador de entidad | ENTIDAD, limitado a su área | nueva-incidencia.html#entidad |
| Administrador general | ADMIN | dashboard-admin.html |

La pantalla administrativa es únicamente una bienvenida protegida. No incorpora gestión de usuarios ni reportes municipales.

La relación existente `usuario_area → area_entidad → entidad` determina el área. Se requiere exactamente una asignación activa; un usuario sin área o con asignaciones ambiguas no obtiene acceso de entidad. Las cuentas, roles, áreas y entidades inactivas se rechazan. Los nombres se obtienen de PostgreSQL.

## Sesiones y contraseñas

- Sesión opaca aleatoria de 256 bits; cookie `puno_session`, HttpOnly, SameSite=Strict, duración máxima 8 horas. Secure cuando la petición utiliza HTTPS.
- El servidor conserva el resumen SHA256 del token y el ID de usuario en memoria. Reiniciar la API invalida las sesiones; no se crearon tablas.
- Cada petición protegida vuelve a consultar el usuario, su rol y el área activa. Una bandera local no autoriza acceso.
- Hash de contraseña con scrypt asíncrono de Node: N=32768, r=8, p=3, sal aleatoria de 16 bytes y clave derivada de 64 bytes. Comparación con timingSafeEqual.
- Límite combinado de 30 intentos de login/registro por dirección IP cada 15 minutos; validación de origen para escrituras y CORS restringido a la vista previa.
- Cookie únicamente en el navegador; no se guarda el token ni el rol como autorización en localStorage. La caché de reportes se separa por ID del usuario y se limpia al entrar/salir.
- El frontend comprueba `/auth/me`; páginas restauradas mediante Atrás vuelven a validar la sesión. Los enlaces de acceso simulado a entidades dejan de estar disponibles.
- Usar el host 127.0.0.1. La vista previa localhost:4174 se normaliza a ese host para no mezclar cookies de sitios diferentes.

Documentación técnica de scrypt: https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback

## Endpoints

| Endpoint | Comportamiento |
|---|---|
| POST /api/auth/register | Crea solo CIUDADANO e inicia sesión |
| POST /api/auth/login | Valida correo/password y devuelve usuario seguro |
| GET /api/auth/me | Devuelve identidad autenticada; 401 si no hay sesión |
| POST /api/auth/logout | Revoca token y elimina cookie |
| GET /api/reportes | Solo reportes del ciudadano autenticado |
| POST /api/reportes | Obtiene id_usuario de sesión, no del JSON |
| POST /api/reportes/:id/archivos | Comprueba propiedad antes de recibir fotografía |
| GET /api/entidad/reportes | Solo el área de la sesión ENTIDAD |
| POST /api/entidad/reportes/:id/estado | Transición autorizada dentro de su área |
| POST /api/entidad/reportes/:id/solucion | Evidencia y solución dentro de su área |
| GET /api/admin/session | Comprueba rol ADMIN |

Las rutas anteriores `/api/entidad/:area/reportes...` siguen funcionando; `:area` es solo una etiqueta y nunca cambia los permisos. Una entidad que cambia esa etiqueta a Limpieza sigue recibiendo únicamente su área real. Un ID de reporte ajeno devuelve 404. Un rol incorrecto devuelve 403; sin sesión, 401.

Las fotografías `/uploads/...` requieren sesión y pertenencia al ciudadano o área correspondiente. La IA conserva sus contratos, proveedor y configuración: únicamente se añadió el control de acceso CIUDADANO en el router. No se hicieron llamadas reales a Gemini durante estas pruebas.

## Cambios PostgreSQL autorizados

No hubo migraciones, tablas ni columnas nuevas. Con autorización expresa se concedió al usuario restringido:

- INSERT en `usuario` y `usuario_area`.
- USAGE en las secuencias existentes de ambas tablas.
- UPDATE únicamente en `reporte.id_estado` y `reporte.fecha_actualizacion`.

Estos permisos se aplicaron solo después de comprobar `current_database() = 'puno_reporta_prueba_ia'`. La base principal no se conectó ni modificó. Las credenciales administrativas se utilizaron únicamente con el nombre de la copia fijado explícitamente, nunca con el destino de `.env`.

Cuenta creada: `vias.prueba@municipalidad.test`, id_usuario 6, rol existente Trabajador, área 1, Sub Gerencia de Obras Públicas y Mantenimiento. La contraseña generada se entrega en `%TEMP%/puno-vias-test-credentials.json`, fuera del repositorio, sin imprimirla en consola. No se creó ninguna cuenta de otra entidad ni de administrador.

Las cinco cuentas históricas tienen hashes de formato no reconocido por esta implementación. No se cambiaron ni se aceptaron como contraseñas de texto plano. Para probar como ciudadano, registrarse desde la interfaz. La prueba visual creó una cuenta ciudadana identificable, id_usuario 7; sus credenciales están en `%TEMP%/puno-citizen-test-credentials.json`.

## Archivos

Nuevos:

- backend/services/auth.js
- backend/middleware/session.js
- backend/routes/auth.js
- backend/scripts/create-vias-account.cjs
- backend/tests/auth.test.cjs
- backend/tests/session-fixture.cjs
- backend/integration/auth-live.cjs
- backend/AUTENTICACION-ROLES.md
- dashboard-admin.html
- js/admin-access.js
- tests/auth-session.cjs

Modificados:

- backend/server.js
- backend/routes/api.js
- backend/routes/entidad.js
- backend/controllers/reportes.js
- backend/services/reportes.js
- backend/services/entidad.js
- backend/middleware/report-idempotency.js
- backend/tests/reportes.test.cjs
- backend/tests/entity.test.cjs
- nueva-incidencia.html
- js/auth-service.js
- js/auth.js
- js/app.js
- js/report-store.js
- js/new-incidence.js
- js/entity-dashboard.js
- scripts/preview.cjs
- tests/incidence.test.cjs
- tests/auth-browser.cjs
- tests/dashboard-browser.cjs
- tests/my-reports-browser.cjs
- tests/navigation-browser.cjs
- tests/report-form-browser.cjs
- tests/entity-panel-browser.cjs

Los archivos temporales de auditoría, permisos y resultados están bajo `.tmp/`. No contienen contraseñas ni claves de Gemini.

## Verificación y reproducción

1. Iniciar `node backend/server.js` y `node scripts/preview.cjs` en terminales separadas.
2. Abrir http://127.0.0.1:4174/iniciar-sesion.html.
3. Crear una cuenta ciudadana o entrar con la creada en la prueba. Enviar una incidencia y cerrar sesión.
4. Entrar como Vías con las credenciales entregadas. El título y las filas corresponden al área de la cuenta.
5. Cambiar la URL a `#entidad-limpieza`: no debe cambiar el área autorizada.
6. Cerrar sesión y usar Atrás o abrir directamente la URL del panel: vuelve al login.

Pruebas sin PostgreSQL: `node --test backend/tests/*.test.cjs tests/incidence.test.cjs` — 87 aprobadas, 0 fallidas. Cubren hashes, sesiones reales con cookies sobre base simulada, rol incorrecto, usuario inexistente, contraseña incorrecta, registro público, área manipulada, propiedad de fotografías, logout, integridad y regresiones del formulario.

Prueba real: `node backend/integration/auth-live.cjs` — 24 comprobaciones aprobadas. **Crea un reporte nuevo y dos fotografías de prueba**, no ejecutar esperando solo lectura. Necesita los archivos de credenciales de pruebas. Se ejecutó sobre el reporte 39: ciudadano 7 → Vías 1 → En proceso → Solucionado, con foto inicial, evidencia e historial. Comparación de huellas confirmó que los reportes anteriores permanecieron idénticos. No llama a Gemini.

Chrome: auth-browser, dashboard-browser, my-reports-browser, navigation-browser, report-form-browser y entity-panel-browser; cinco tamaños por suite. Sin errores JS ni desbordamientos. Navegación: 25 transiciones comprobadas. Entidad: URL manipulada, logout, Atrás y entrada directa comprobados. auth-browser crea una cuenta ciudadana nueva y report-form-browser puede crear un reporte de prueba; las demás suites consultan datos existentes.

## Pendiente para producción

HTTPS, persistencia compartida de sesiones si hay varios procesos, despliegue y orígenes definitivos. Recuperación de contraseñas y migración deliberada de credenciales históricas requieren una etapa propia; nunca asumir que un hash desconocido es una contraseña válida. Administración municipal completa y creación de cuentas de entidad desde su interfaz siguen pendientes. No se necesita cambiar el esquema para el flujo actual.
