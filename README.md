# PUNO REPORTA

Plataforma para el registro y seguimiento de incidencias urbanas en Puno. La pantalla principal conserva su diseño. El acceso tiene interfaz responsive y navegación conectada mediante una sesión simulada, sin autenticación real.

## Ejecutar

Para probar el flujo completo, ejecutar desde la carpeta del proyecto:

```powershell
node scripts/preview.cjs
```

Abrir `http://127.0.0.1:4173`. Detener con Ctrl+C. Requiere Node.js, sin instalar paquetes. Este servidor sirve exclusivamente archivos estáticos para desarrollo: no tiene API y no recibe ni guarda reportes.

La portada y el formulario también se pueden abrir desde `index.html`, pero el permiso de geolocalización depende del contexto seguro y de la configuración del navegador. En un celular se necesitará HTTPS para probar GPS fuera de localhost; no basta con acceder por HTTP a la IP de la computadora. Referencia: [getCurrentPosition en MDN](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).

## Estructura

- `index.html`: portada y modal «Accede para reportar».
- `iniciar-sesion.html` y `crear-cuenta.html`: formularios de acceso y registro.
- `css/access.css`: modal centrado, panel inferior en celular y formularios de acceso.
- `js/auth-service.js`: sesión simulada por pestaña y destino permitido después del acceso.
- `js/auth.js`: validación visual, navegación y conservación del destino entre login y registro.
- `tests/access.test.cjs`: pruebas de navegación y sesión simulada.
- `nueva-incidencia.html`: formulario responsive y resumen dentro de la misma pantalla.
- `css/variables.css`: colores, tipografía, espaciado en múltiplos de 8 px y dimensiones comunes.
- `css/global.css`: base de estilos y accesibilidad.
- `css/layout.css`: distribución adaptable a celular, tablet y escritorio.
- `css/components.css`: marca, botones y categorías.
- `css/incidence.css`: estilos exclusivos del modal, formulario y revisión; reutiliza las variables y botones existentes.
- `js/app.js`: apertura del modal sin sesión o continuación al reporte con sesión.
- `js/incidence-data.js`: validación técnica de coordenadas y copia inmutable del reporte.
- `js/new-incidence.js`: foto local, pasos del formulario y revisión/envío de prueba.
- `js/report-location.js`: mapa Leaflet, lectura GPS, selección manual y confirmación de ubicación.
- `js/report-detail.js`: detalle de solo lectura, fotografía local, mapa fijo y seguimiento visual.
- `scripts/preview.cjs`: vista previa local de archivos estáticos, sin dependencias.
- `tests/incidence.test.cjs`: pruebas de lógica con Node.js, sin utilizar fotos o GPS reales.
- `assets/logo-puno-reporta.png`: copia exacta del PNG proporcionado, sin transformaciones.
- `assets/icons/` y `assets/images/`: directorios reservados para futuros recursos aprobados.

Se usa HTML5, CSS3 y JavaScript Vanilla. Solo el mapa incorpora Leaflet 1.9.4 desde unpkg con verificación de integridad y cartografía OpenStreetMap. El objeto temporal de incidencia no presupone un esquema de base de datos; las cuatro categorías se definen en el selector y coinciden con las de la portada.

## Alcance actual

«Reportar incidencia» abre el modal «Accede para reportar» si no hay sesión. Solo contiene el logo, título, explicación, enlaces a login/registro y una X para cerrar. En celular se presenta como panel inferior; desde tablet es un modal centrado, con un máximo de 540 px. Escape o la X lo cierran y el diálogo nativo restaura el foco. «Iniciar sesión» en la portada va directamente al login.

Después de completar login o registro simulados, se abre el Dashboard ciudadano en `nueva-incidencia.html#inicio`, también cuando se llegó desde «Reportar incidencia». El destino es interno y fijo. Con sesión activa, «Reportar incidencia» desde la portada sigue abriendo directamente el formulario.

La sesión es una simulación autorizada para esta etapa, no una validación de identidad: basta completar los campos requeridos con un correo de formato válido y una contraseña no vacía; registro solicita además el nombre. Únicamente se guarda `puno-reporta-demo-session=true` en `sessionStorage`, sin correo, nombre ni contraseña. No se crean usuarios reales ni se envían credenciales. Si el navegador bloquea almacenamiento, la sesión queda solo en memoria durante esa página. La bandera permite probar la navegación, pero no protege el acceso directo a archivos. La autenticación real se implementará más adelante.

«Nueva incidencia» se organiza en cuatro pasos dentro de la misma página: categoría mediante tarjetas seleccionables; foto y descripción; ubicación; entidad y revisión. «Atrás» y «Siguiente» conservan los datos introducidos. El indicador identifica el paso actual y el foco se mueve a su título. En móvil las categorías se apilan; desde 768 px la foto/descripción y la entidad/resumen se distribuyen en dos columnas. El último paso muestra el resumen y una miniatura de la foto. La entidad sugerida se asigna automáticamente según la categoría mediante js/category-routing.js, usando áreas genéricas y sin nombres oficiales. No se solicita selección manual.

La selección de foto usa una URL local temporal; «Tomar foto» solicita captura mediante el selector del dispositivo. La disponibilidad de cámara depende del navegador ([atributo capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture)). Se puede reemplazar o quitar la foto y se liberan las URLs temporales. Los formatos que el navegador no pueda decodificar muestran un mensaje.

La ubicación es obligatoria. El mapa inicia en Puno sin marcador; su centro no representa una selección. El usuario elige GPS (una sola llamada a `getCurrentPosition` con `enableHighAccuracy: true`) o selección manual mediante clic/toque en el mapa. Se mueve un único marcador y se muestran latitud, longitud y precisión. La precisión manual es `null`. Con teclado, las flechas desplazan el mapa y Enter selecciona su centro en modo manual. Permiso denegado, ubicación no disponible, tiempo de espera y errores de carga tienen mensajes explícitos.

«Confirmar ubicación» guarda `latitude`, `longitude`, `accuracy`, `locationSource` (gps/manual) y `locationConfirmed: true` en el estado del formulario. Una ubicación confirmada no cambia por clics, desplazamiento del usuario ni respuestas GPS tardías. «Cambiar ubicación» revoca la confirmación y bloquea otra vez el envío. «Enviar reporte» permanece deshabilitado sin confirmación; JavaScript y la capa de datos también comprueban ese requisito. La copia del reporte conserva estos datos en `report.location`.

El mapa requiere Internet. Usa las teselas HTTPS oficiales con atribución visible y caché normal del navegador, sin descargas masivas. Abrir por localhost o HTTPS, no mediante `file://`, para que el proveedor reciba el referente del sitio. Referencias: [guía de Leaflet](https://leafletjs.com/examples/quick-start/) y [política de teselas de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/).

El paso «Revisión final» muestra categoría, fotografía, descripción si existe, ubicación y entidad sugerida. «Enviar reporte» crea el objeto central, guarda sus datos y fotografías en localStorage y muestra la confirmación del mismo objeto con código PR-00001, categoría, fecha, estado y entidad. No vuelve a consultar GPS ni envía datos a una entidad real. Si falla el guardado, informa del error y no confirma el registro.

Son obligatorias la categoría, una fotografía decodificada correctamente y la ubicación confirmada. Siguiente permanece deshabilitado mientras falte el requisito del paso actual; la lógica también bloquea avances mediante Enter. Enviar reporte exige categoryConfirmed, photoConfirmed y locationConfirmed. La descripción es opcional y su fila se omite en el resumen si queda vacía. No se exige selección manual de entidad. Cambiar la categoría actualiza la entidad sugerida; quitar o reemplazar una foto bloquea el envío hasta validarla nuevamente. No se han definido límites de longitud de descripción ni tamaño máximo de foto.

## Referencia visual aprobada

La composición se inspira en las referencias de celular, tablet, laptop y escritorio proporcionadas: presentación con paisaje y teléfono ilustrativos, botón principal amarillo y categorías en dos o cuatro columnas. En menos de 900 px el texto, la ilustración y las acciones se apilan; desde 900 px se distribuyen en dos columnas. Los textos conservan tamaños legibles y la página puede desplazarse verticalmente.

El teléfono es una ilustración decorativa en HTML/SVG, sin geolocalización ni datos reales. Se conserva el PNG oficial del logo sin modificaciones. No se incorporan estadísticas, testimonios, un proceso de reporte todavía no definido ni controles de navegación sin destino.

### Recurso gráfico

`assets/images/puno-ilustracion.png`: original del paisaje generado con la herramienta integrada ImageGen. La página utiliza `assets/images/puno-ilustracion.jpg`, una copia comprimida a calidad 85 para reducir la descarga. Es una ilustración evocativa, no una fotografía ni una representación geográfica exacta. Ambos recursos están guardados localmente; la página no requiere servicios externos durante la carga.

Prompt utilizado: «Use case: stylized-concept. Asset type: landscape hero illustration for a citizen urban-reporting website in Puno, Peru. Create a refined clean editorial digital illustration: blue Lake Titicaca, distant layered Andean mountains, a hillside city of small warm buildings, a sandstone twin-tower Andean cathedral on the right shore, a tiny reed boat, golden totora reeds in foreground. Crisp inviting daytime, soft clouds, bright sky blue, deep institutional navy details and golden accents, polished illustrated realism like a civic website illustration. Wide 3:2 composition, scenery fills frame, principal architecture on right, water and mountains to left, no text, no logos, no letters, no phone, no UI, no frame, no watermark. This is an evocative illustration, not a geographical map. Output as project asset and provide local saved path if available.»

## Dashboard ciudadano

Se abre después del acceso simulado o desde «Inicio» en la navegación del ciudadano. Comparte documento con el formulario, la lista y el detalle para mantener el mismo arreglo central de reportes y sus fotografías con persistencia local centralizada. «Reportar» abre el formulario existente y conserva un borrador en curso; tras enviar, permite iniciar otro. «Perfil» está visible y deshabilitado, pendiente de desarrollo.

- `js/citizen-dashboard.js` calcula los indicadores con el arreglo recibido: longitud total y conteo por estado exacto («Reportado», «En proceso», «Solucionado»).
- Los últimos reportes se obtienen ordenando una copia del arreglo por `createdAt` descendente y tomando como máximo tres, sin alterar la fuente original.
- Las miniaturas utilizan los archivos originales y liberan sus URLs al salir del dashboard. Los botones «Ver detalle» abren el detalle existente; «Ver todos mis reportes» abre la lista existente.
- `css/citizen-dashboard.css` define navegación compacta, indicadores 2 × 2 en móvil y cuatro columnas desde 768 px, filas adaptables y contenido de ancho limitado.

Para probar: iniciar sesión, comprobar contadores en cero, crear un reporte y pulsar «Inicio». Verificar el contador y su aparición entre los recientes. Abrir su detalle y volver a Mis reportes. Crear más reportes y comprobar que solo aparecen los tres más recientes en Inicio. Los reportes guardados se recuperan al recargar. No se crean datos ficticios para llenar el dashboard.

## Siguiente etapa

### Área de Vías — gestión simulada

Acceso directo: `nueva-incidencia.html#entidad-vias`. Para gestionar un reporte recién creado, usar «Acceso de prueba · Área de Vías» al pie de la confirmación o de Mis reportes. También se puede cambiar únicamente el fragmento de la URL a `#entidad-vias` en la misma pestaña, sin recargar. El acceso es una herramienta de simulación y no autentica personal de una entidad.

`js/entity-reports.js` usa el mismo arreglo central del ciudadano: filtra categoría `vias` o asignación al área genérica de vías, excluyendo expresamente Limpieza, Alumbrado y Agua. Actualiza el mismo objeto mediante ReportStore al cambiar el estado, conservando foto, código, categoría y ubicación originales. `js/entity-dashboard.js` presenta contadores, tres reportes recientes, listas por estado y detalle de solo lectura con acciones separadas. `css/entity-dashboard.css` limita sus estilos a este espacio: menú lateral, tarjetas de resumen y dos columnas de detalle; en móvil utiliza navegación inferior y una columna.

Solo se permite `Reportado → En proceso → Solucionado`. «Registrar solución» permite seleccionar o tomar una fotografía y previsualizarla; debe decodificarse correctamente para habilitar el cierre. La observación es opcional. Al solucionar se agregan únicamente `solutionPhoto`, `solutionNote` y `solvedAt`. El estado solucionado no admite nuevas transiciones. La ubicación no solicita GPS nuevamente.

Prueba completa: crear un reporte de Vías, abrir el área, consultar su detalle, marcarlo en proceso, registrar una foto de solución y marcarlo como solucionado. Volver al ciudadano y comprobar los contadores y estado. Crear un reporte de otra categoría y verificar que no aparece en el área. Todos los cambios y fotografías se guardan en localStorage.

La separación entre validación de transiciones, presentación de entidad y detalle compartido permite adaptar posteriormente otras áreas. No se han creado dashboards de otras entidades ni de administración. La autenticación de entidad, permisos reales y persistencia en servidor siguen pendientes.

### Detalle del reporte

Desde la confirmación, abrir «Ver mis reportes» y pulsar «Ver detalle» en el registro deseado. La vista se presenta dentro de `nueva-incidencia.html` y lee los objetos de la colección central. «Volver a mis reportes» restaura la lista y el foco en el botón utilizado.

El detalle utiliza el mismo objeto del reporte: código, estado, categoría, entidad, archivo de fotografía, descripción opcional y coordenadas confirmadas. `createdAt` se fija al registrar el reporte simulado como fecha ISO; se muestra en horario de Lima. La foto mantiene su proporción y su URL temporal se libera al cerrar el detalle. El mapa Leaflet/OpenStreetMap tiene un marcador fijo y no solicita GPS. Si no carga la cartografía, las coordenadas siguen visibles.

El seguimiento representa «Reportado», «En proceso» y «Solucionado», activando los pasos hasta el estado actual. No hay controles para cambiar estado, entidad ni datos del reporte. Queda preparada la representación de los tres estados para una futura fuente de datos; actualmente todos los reportes se crean como «Reportado». Los reportes y fotografías se conservan en este navegador. El ciudadano ve también la evidencia, observación y fecha de solución.

Comprobar el detalle con y sin descripción, volver a la lista, crear otro reporte y abrir ambos para verificar sus datos independientes. Revisar en móvil, tablet y escritorio; el contenido usa una columna en móvil y dos en pantallas grandes. Las pruebas automatizadas verifican navegación, fecha, coordenadas sin solicitud GPS, omisión de descripción y los tres estados visuales.

Revisar este flujo. Quedan pendientes los requisitos de autenticación, las entidades reales, reglas adicionales de asignación y límites de archivos/texto, y el guardado/envío real cuando se autorice. No se ha avanzado más allá de «Nueva incidencia».


## Flujo conectado y almacenamiento local

La fuente única está en `js/report-store.js`: `ReportStore.reports`. Ofrece `loadReports()`, `saveReports()`, `createReport()`, `updateReport()` y `getReportById()`. Todas las llamadas a localStorage están centralizadas bajo la clave `puno-reporta-reports-v1`. Se guarda JSON; las fotos se convierten con FileReader a data URLs para recuperarlas tras recargar. No se guardan URLs blob transitorias.

El ciudadano simulado tiene el identificador fijo `ciudadano-local`: las vistas ciudadanas filtran por ese identificador. No hay cuentas ni aislamiento de usuarios reales. Vías filtra categoría `vias` o entidad «Área de Vías», excluyendo las otras categorías. El código y el id se mantienen durante todo el flujo; los códigos continúan a partir del último guardado. Las coordenadas están disponibles como campos directos y en `location` para compatibilidad con las vistas existentes, y nunca se modifican al atender el reporte.

Las transiciones se guardan antes de modificar el objeto central. Si falta espacio o el navegador bloquea el guardado, no se presenta una operación exitosa. Las modificaciones entre pestañas del mismo origen refrescan las vistas mediante el evento storage. Usa siempre el mismo origen, por ejemplo `http://127.0.0.1:4173`; localhost y 127.0.0.1 tienen almacenamientos separados. No hay backend ni sincronización entre dispositivos.

### Prueba manual de los 18 pasos

1. Entrar mediante el login simulado.
2. Pulsar Reportar incidencia y seleccionar Vías.
3. Adjuntar una fotografía.
4. Seleccionar y confirmar ubicación.
5. Revisar y enviar el reporte; anotar su código.
6. Abrir Mis reportes y comprobar «Reportado».
7. Abrir el acceso de prueba del Área de Vías o `nueva-incidencia.html#entidad-vias` en el mismo origen.
8. Localizar exactamente el código anotado.
9. Abrir su detalle y pulsar Marcar en proceso.
10. Pulsar Volver al ciudadano.
11. Consultar Mis reportes: debe indicar En proceso.
12. Volver al Área de Vías y abrir ese código.
13. Pulsar Registrar solución y adjuntar una fotografía de evidencia; la observación es opcional.
14. Pulsar Marcar como solucionado.
15. Volver al ciudadano.
16. Comprobar Solucionado en Mis reportes y en el resumen.
17. Abrir Ver detalle.
18. Comprobar foto original, foto de solución, observación si existe, fecha y los tres pasos activos. Recargar y repetir la consulta: todo debe conservarse.

## Revisión manual

1. Abrir la portada sin sesión (por ejemplo en una ventana privada), pulsar «Reportar incidencia» y comprobar el modal. Cerrar con Escape o X y verificar el retorno del foco. Probar login y registro desde el modal con datos ficticios; ambos deben continuar al dashboard. Probar también «Iniciar sesión» directo desde la portada: abre el login sin modal y continúa al dashboard después de completar el formulario. Volver a pulsar «Reportar incidencia» con sesión: debe abrir el reporte directamente. Para reiniciar la simulación en la misma pestaña, ejecutar `sessionStorage.removeItem('puno-reporta-demo-session')` en la consola del navegador.
2. Elegir una categoría, seleccionar una foto y reemplazarla o quitarla. Probar «Tomar foto» en un móvil compatible. Escribir una descripción.
3. Pulsar el botón de ubicación y conceder permiso; comprobar las coordenadas y precisión. Moverse no debe provocar actualizaciones automáticas.
4. Probar permiso denegado y la selección manual. Tocar dos puntos y comprobar que se mueve un solo marcador. Confirmar y comprobar que se habilite el envío. Otro clic ya no debe cambiar las coordenadas. «Cambiar ubicación» debe volver a bloquear el envío. Una respuesta GPS tardía no debe sustituir una selección manual.
5. Dejar la descripción vacía, revisar los datos y pulsar «Enviar reporte». Comprobar el código de prueba, el estado «Reportado» y el aviso de simulación. «Ver mis reportes» debe mostrar el reporte creado. «Crear otro reporte» debe volver al primer paso con todos los requisitos pendientes. Completar otro reporte y comprobar un código distinto y ambos registros en la lista. Recargar conserva los reportes guardados.
6. Revisar teclado y tamaños de 360, 768 y 1280 px; no debe haber desbordamiento horizontal.

Pruebas de lógica automatizadas:

```powershell
node --test tests/access.test.cjs tests/incidence.test.cjs
```

Estas pruebas simulan el DOM y las respuestas del navegador; no sustituyen la revisión visual ni los permisos y cámara en un dispositivo real.



## Área de Limpieza: misma plantilla funcional

Acceso: `nueva-incidencia.html#entidad-limpieza` o «Acceso de prueba · Área de Limpieza» al pie de la confirmación/Mis reportes. Vías conserva `#entidad-vias`. No son accesos de autenticación real.

La configuración `EntityAreas` en `js/category-routing.js` contiene únicamente Vías y Limpieza: categoría, nombre visible, nombres anteriores compatibles y ejemplo de observación. Los reportes nuevos de limpieza se asignan a «Área de Limpieza». Los antiguos siguen visibles sin reescribir sus datos.

Se reutiliza una sola instancia de EntityDashboard y la misma estructura HTML, detalle con mapa, filtros de estados, carga/validación de evidencia y ReportStore. EntityReports filtra según la configuración activa: coincide categoría o entidad, pero rechaza una categoría conocida de otra área. El tema `data-area="limpieza"` aplica acentos verdes e icono de residuos sin cambiar los colores semánticos de los estados ni las pantallas ciudadanas.

Para probar: crear un reporte Limpieza, comprobar que no aparece en Vías, abrir Limpieza, marcar En proceso, adjuntar evidencia y solucionar. Volver al ciudadano y comprobar la misma solución; recargar conserva los datos. No se han habilitado Alumbrado, Agua ni administración.

## Registro del formulario en PostgreSQL

Nueva incidencia ahora usa POST http://localhost:3000/api/reportes. El primer paso añade un selector de tipo que carga GET /api/tipos-incidencia?categoria=ID. Requiere categoría y tipo reales, foto local y ubicación confirmada; descripción opcional. Se utiliza temporalmente id_usuario=1 (debe estar activo en PostgreSQL).

El envío contiene únicamente id_usuario, id_categoria, id_tipo_incidencia, descripcion, latitud, longitud, origen_ubicacion y precision_metros. No incluye foto, código, estado ni área. La confirmación muestra el código real; ReportStore.cacheRemoteReport conserva id_reporte y codigo en el respaldo local. Los dashboards y cambios de estado siguen siendo simulados; esta etapa conecta únicamente el registro inicial.

Una falla de API conserva el formulario y no crea un éxito local. Si PostgreSQL confirma pero falla localStorage, se muestra el registro exitoso con aviso sobre el respaldo, sin repetir el POST. Si se pierde la respuesta por conexión, comprobar PostgreSQL antes de reenviar: aún no hay idempotencia en el servidor.

### Prueba de integración

1. Ejecutar npm start dentro de backend y node scripts/preview.cjs desde la raíz en terminales separadas.
2. Abrir http://127.0.0.1:4173/nueva-incidencia.html. Elegir categoría, esperar los tipos y seleccionar uno. Si falla la carga, usar Reintentar carga tras encender el backend.
3. Adjuntar foto, confirmar ubicación y enviar desde la revisión.
4. En DevTools → Network → Fetch/XHR, abrir reportes. Comprobar POST, Request Payload y respuesta 201 con ok:true, id_reporte y codigo.
5. Console muestra temporalmente categoría, tipo, coordenadas, JSON y respuesta. PunoCategories.getSelected() y PunoCategories.getSelectedType() permiten inspeccionar la selección.
6. En PostgreSQL ejecutar SELECT * FROM reporte WHERE id_reporte = ID_DEVUELTO; y SELECT * FROM historial_estado WHERE id_reporte = ID_DEVUELTO; sustituyendo ID_DEVUELTO por el ID recibido.

No se suben fotografías al servidor. Las secciones previas de este documento describen también las etapas anteriores de simulación.
