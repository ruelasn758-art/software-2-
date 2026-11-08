# Puno Reporta

Prototipo académico para registrar baches, residuos, fallas de alumbrado y fugas con una foto y un punto en el mapa. El ciudadano consulta el estado; el operador del área verifica el problema, registra avances y adjunta evidencias. No es un canal oficial de la municipalidad. En demostraciones, usar datos ficticios.

## Iniciar desde una copia nueva

Se necesita Python 3.10 o superior. En Windows, abre **iniciar.bat** y visita **http://127.0.0.1:5000**. Mantén la ventana abierta. Para abrirlo desde el teléfono con GPS usa **iniciar_movil.bat** y su enlace HTTPS temporal (ver [acceso móvil](MOVIL.md)).

En otra plataforma, desde la raíz:
    
    python -m venv .venv
    source .venv/bin/activate
    python -m pip install -r requirements.txt
    python app.py

Una instalación nueva sin configuración PostgreSQL crea SQLite, los catálogos y las cuentas iniciales. Sus contraseñas aleatorias quedan solo en **private/security/cuentas-locales.txt**. Para una demostración usa una **copia nueva**, nunca la base de ciudadanos. Si existe una configuración PostgreSQL, se usa esa base; no se cambia a SQLite en caso de fallo. Ver [PostgreSQL](POSTGRESQL.md), [clasificación de fotos](IA_FOTOS.md) y [recuperación](RECUPERACION_CORREO.md).

## Qué probar

1. Registrar un ciudadano ficticio y adjuntar una imagen de prueba como documento.
2. Desde **Administrador → Gestionar cuentas**, revisar y verificar al ciudadano.
3. Con la cuenta ciudadana, crear una incidencia con foto, categoría y pin. Anotar su código. Se pueden adjuntar varias referencias; la sugerencia de la IA es opcional y editable.
4. Con la cuenta operadora del área, verificar que recibió la alerta, cambiar a **En proceso**, adjuntar evidencia y marcar **Solucionado**. En SQLite nuevo el operador inicial atiende alumbrado.
5. Desde **Mis reportes**, comprobar estado y evidencia. En una ventana privada sin sesión, el código no debe revelar el nombre ni permitir abrir sus fotografías.

## Pruebas reproducibles

En el entorno virtual: **python -m pip install -r requirements-dev.txt**.

- **python -m pytest -q -m "not postgres"**: pruebas HTTP contra SQLite temporal; no requieren PostGIS, Edge, Playwright, internet, correo ni datos de otra PC.
- **python -m pytest -q**: ejecuta las anteriores y las de PostgreSQL si están configuradas. Si falta la configuración, las de PostgreSQL se indican como omitidas.
- Para probar PostgreSQL/PostGIS, configura **PUNO_TEST_PG_CONFIG** con la ruta a un JSON local de conexión de un servidor de pruebas (host, port, dbname, user, password) con permisos de crear bases e instalar PostGIS. En PowerShell: **$env:PUNO_TEST_PG_CONFIG = 'C:\ruta\pruebas.json'** y **python -m pytest -q -m postgres**. Se crea una base con nombre aleatorio, se aplican los scripts SQL, se comprueba el flujo por HTTP, el historial y las evidencias, y se elimina al terminar. No se clona la base de ciudadanos.
- Las pruebas opcionales de navegador usan Node, **npm install --no-save playwright** y **npx playwright install chromium**. No son necesarias para pytest.

- **python -m pytest -q tests/test_http_real.py**: levanta Flask en un puerto temporal y realiza solicitudes HTTP con cookies, formularios y archivos. Recorre registro, revisión administrativa, login, reporte, atención y consulta. También comprueba las filas de la base. No inyecta sesiones para entrar en los roles.
- **node --test tests/clasificador.test.cjs**: cinco casos del controlador de IA: sugerencia editable, prioridad de elección manual, foto reemplazada, abstención y recuperación de un error. Usa respuestas simuladas del Worker; no mide la precisión de CLIP. Si Node está instalado, pytest ejecuta estos casos mediante **tests/test_innovacion.py**; si no, indica esa comprobación como omitida.

Para la revisión manual: [evidencia de integración e innovación](EVIDENCIA_PRACTICA9.md).

La [hoja de aceptación](ACTA_ACEPTACION.md) se completa con la otra mesa durante la prueba. Un resultado automático no sustituye su conformidad.

## Archivos privados

No publicar **private/**, credenciales, archivos de bases de datos, fotos de usuarios ni capturas con datos personales. Los adjuntos de ejecución se guardan bajo **static/uploads/** y se sirven con control de acceso. El repositorio incluye el código, el esquema y los recursos de diseño, no una instalación personal.
