# Sugerencia de categoria a partir de fotografias

Al seleccionar o arrastrar una foto JPG, PNG o WEBP (hasta 10 MB), el navegador ejecuta un modelo de vision CLIP y compara la imagen con descripciones de baches, basura, alumbrado y fugas. No detecta gravedad ni confirma que exista una falla.

Si hay una sugerencia clara, selecciona la categoria y actualiza su area responsable. El ciudadano puede pulsar Cambiar categoria o elegir directamente otro boton. La eleccion manual no es sobrescrita por respuestas tardias. Al enviar, se guarda la categoria final mediante el flujo existente; no se cambia el esquema de la base de datos.

Tambien hay opciones de descarte para imagenes normales, otros problemas e imagenes no identificables. Los umbrales son heuristicos, no una precision medida con fotografias de Puno. Una escena ambigua requiere seleccion manual.

La inferencia se ejecuta en un Web Worker del dispositivo, sin claves API ni envio de la foto a un proveedor de IA. La foto se envia al servidor del proyecto cuando el ciudadano registra el reporte, como antes. La primera utilizacion descarga automaticamente la biblioteca y el modelo desde jsDelivr y Hugging Face; requiere internet, memoria y puede tardar. El navegador puede conservar los archivos en cache. Si el dispositivo no puede ejecutar el modelo, se mantiene la seleccion manual.

Antes de elegir la foto se informa del tamaño aproximado del modelo (154 MB, más componentes). Desmarca «Sugerir categoría al subir la foto» para evitar la descarga.

Implementacion: Transformers.js 2.17.2, modelo cuantizado Xenova/clip-vit-base-patch32. Documentacion del modelo: https://huggingface.co/Xenova/clip-vit-base-patch32

Prueba aislada en Windows (requiere el entorno de pruebas con Playwright y su Chromium): definir MOBILE_BROWSER_TEST=tests/verificar_foto.cjs y ejecutar tests/verificar_movil.py con Python. Utiliza una base temporal. Comprueba cambios manuales, respuestas antiguas, descarte, errores, guardado final y una inferencia real con un logo, que no debe convertirse en reporte automaticamente.
