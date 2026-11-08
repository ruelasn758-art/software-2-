# Identidad visual

El símbolo original de `Descargas/LOGO SISTEMA` se conserva sin modificaciones en `assets/logo-symbol.png`. Todas las páginas, el modal de acceso, las barras laterales, la cabecera móvil de entidad y los favicons utilizan ese mismo archivo.

En `js/brand.js`, `PlatformBrand.name` está vacío. Para añadir un nombre de producto, cambiar únicamente esa propiedad: los elementos `data-brand-name` lo mostrarán y se añadirá al título de la página. El nombre no forma parte de la imagen. `PlatformBrand.logo` controla el símbolo mediante `data-brand-logo`, el favicon y la variable CSS `--brand-symbol`. Los HTML incluyen la misma ruta como respaldo sin JavaScript.

El PNG proporcionado tiene fondo blanco; se utiliza íntegro, con proporciones conservadas y bordes suaves sobre fondos oscuros. No se ha generado otra versión ni duplicado por pantalla.

El antiguo archivo `assets/logo-puno-reporta.png` se conserva sin referencias en la interfaz. No se modificaron claves de localStorage, mensajes de diagnóstico, nombres de bases de datos, documentación histórica ni pruebas anteriores. Por eso el nombre anterior puede permanecer en esos archivos internos. Los textos geográficos, fotografías de Puno y lemas sobre la ciudad tampoco se modificaron: esta etapa solo sustituye la marca visual.

Verificación visual: `node tests/brand-browser.cjs`. Pruebas de navegación existentes: `node tests/home-browser.cjs`, `node tests/auth-browser.cjs` y `node tests/navigation-browser.cjs`.
