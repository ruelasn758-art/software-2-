# Evidencia verificable de la Práctica 9

## Integración por HTTP (revisión manual)

Ejecutar: python -m pytest -v tests/test_http_real.py

El caso test_recorrido_http_real_con_base_y_roles:
1. Inicia el servidor Flask con werkzeug.serving.make_server, en 127.0.0.1 y un puerto libre.
2. Crea navegadores independientes con urllib.request y CookieJar. Las solicitudes cruzan una conexión HTTP real.
3. Registra al ciudadano por POST /registro con un archivo PNG. Confirma que la cuenta pendiente aún no puede reportar.
4. Inicia sesión como administrador por POST /ingresar, encuentra la cuenta, lee el formulario y envía su token CSRF para verificarla.
5. Inicia sesión como ciudadano y registra una incidencia con una foto y dos referencias.
6. Inicia sesión como operador y comprueba la alerta de su área. Envía dos evidencias y cambia el estado a Solucionado.
7. Comprueba lo que ve el ciudadano, las filas y la notificación de la base. En PostgreSQL exige tres estados históricos y cinco archivos asociados.
8. Descarga la foto como titular, compara sus bytes y comprueba que el acceso anónimo está bloqueado. El administrador no ve la identidad del titular en el detalle de la incidencia.
9. Detiene el servidor y usa exclusivamente directorios y bases desechables.

La parametrización ejecuta el recorrido en SQLite y PostgreSQL. PostgreSQL necesita PUNO_TEST_PG_CONFIG; si falta, se informa como omitido. No se sustituye por un resultado ficticio.

Archivos para revisar:
- tests/test_http_real.py: peticiones de red y comprobaciones del recorrido.
- tests/conftest.py: bases temporales y aislamiento de adjuntos.
- tests/test_integracion.py: casos individuales con Flask test_client.
- database/02_integracion.sql: historial de estados y auditoría.

## Innovación que ya funciona

La innovación implementada es la sugerencia de categoría a partir de la foto, ejecutada en el dispositivo y corregible por el ciudadano. No equivale a diagnóstico de gravedad ni a una exactitud medida con fotos de Puno.

| Comportamiento | Implementación | Comprobación |
|---|---|---|
| La foto se analiza en un Worker con CLIP | static/js/foto-worker.js | Prueba de navegador opcional tests/verificar_foto.cjs; requiere descargar el modelo |
| La categoría sugerida es editable | static/js/foto-clasificador.js | tests/clasificador.test.cjs |
| Una respuesta tardía no reemplaza una elección manual | contador manual y versión en el controlador | Caso de elección manual |
| Una foto reemplazada invalida su resultado anterior | versión de análisis | Caso de foto reemplazada |
| Si no se reconoce la incidencia, la persona elige | respuesta sin categoría y mensaje de abstención | Caso de abstención |
| Se puede continuar o reintentar si la IA falla | manejo de error del Worker | Caso de recuperación de error |
| Se informa la descarga inicial y se puede desactivar | templates/registrar.html y static/js/app.js | Comprobación visual al abrir Reportar |

Los cinco casos de JavaScript ejecutan el controlador real con DOM y respuestas del Worker simulados. No se atribuyen a estas pruebas la descarga del modelo, la precisión de clasificación, el GPS físico ni la entrega de correo real.

## Resultado observado el 8 de noviembre de 2026

En la copia local, con Node y PostgreSQL/PostGIS configurados: **25 casos de pytest aprobados, 0 fallidos, 0 omitidos**, incluidos ambos recorridos de HTTP real. Dentro del caso del controlador de IA se ejecutaron cinco comprobaciones de Node.

Este resultado se reproduce con python -m pytest -q. No es una calificación ni una aceptación por otra mesa.

## Qué falta verificar humanamente

- El punto manual de integración HTTP: el docente puede leer y ejecutar el recorrido anterior.
- La valoración de innovación: el docente revisa el código y la demostración.
- El acta ACTA_ACEPTACION.md: continúa pendiente de ejecución y conformidad por otra mesa. Ejecutar el calificador desde la laptop del propio equipo no sustituye esa evaluación.
- Si se presenta recuperación por correo, configurar Gmail y verificar la recepción real. El GPS del dispositivo se demuestra en HTTPS y con permisos.

## Por qué el Excel automático no muestra 20/20

El programa del curso asigna automáticamente como máximo 2 de 3 puntos de integración y deja innovación sin puntaje. No debe modificarse el programa ni el Excel para completar los puntos. Las observaciones de ramas/merges y autoría se conservan tal como las devuelve el validador; no se alteraron en este trabajo.
