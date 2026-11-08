# Análisis de fotografías — entorno de pruebas

Solo `puno_reporta_prueba_ia`, rol `puno_reporta_test_app`, puerto 3001. No se ejecutan migraciones ni se crean registros al analizar. Las fotografías se reciben en memoria, con las mismas validaciones de Multer que la carga inicial (JPEG/PNG/WEBP, extensión coincidente, firma y máximo 8 MB). No se guardan archivos temporales.

## Configuración

En `backend/.env.test`:

```dotenv
GEMINI_API_KEY=TU_CLAVE_PRIVADA
GEMINI_MODEL=gemini-2.5-flash-lite
```

Mantener las credenciales aisladas existentes. La clave no debe copiarse al frontend ni a archivos de ejemplo. `.env.test` está ignorado. No se carga `.env`.

Crear la clave desde [Google AI Studio](https://aistudio.google.com/apikey): iniciar sesión, crear una clave y seleccionar o crear el proyecto correspondiente. Mantener el proyecto en el nivel gratuito disponible; esta integración no activa facturación ni configura servicios de Google Cloud. La disponibilidad y los límites dependen de la cuenta y del modelo. Consultar [precios y nivel gratuito](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite). No pegar la clave en el chat. Las variables antiguas de OpenAI ya no se leen.

Desde la raíz del proyecto:

```powershell
node backend/server.js
```

Si ya está iniciado, detener solamente ese servidor con Ctrl+C antes de volver a iniciarlo. La vista previa se inicia, en otra terminal, con `node scripts/preview.cjs`.

## Contrato

`POST http://127.0.0.1:3001/api/ia/analizar-incidencia`, multipart con campo `archivo`. `/api/ia/analizar` conserva un alias y la propiedad `sugerencia` por compatibilidad. `GET /api/ia/estado` informa si está configurada la clave, no certifica saldo ni disponibilidad del proveedor.

El backend consulta categorías y tipos activos; Gemini recibe nombres, nunca decide IDs ni entidad. Una respuesta estructurada se valida nuevamente: categoría desconocida produce fallback; tipo desconocido o de otra categoría se convierte a null. El destino se obtiene con `getDestinations`, incluyendo detección de prioridades ambiguas. Si no hay recomendación única, se mantiene la elección manual de destinos válidos.

Proveedor: Gemini Developer API REST, método `generateContent`, imagen base64 en `inlineData`, `responseMimeType: application/json` y `responseJsonSchema`, plazo de 25 segundos y sin reintentos automáticos. La clave se envía en el encabezado `x-goog-api-key`, nunca en la URL ni en el frontend. Se rechazan respuestas bloqueadas, incompletas, JSON inválido y errores de cuota. `confianza:null`: no se presenta la autoevaluación del modelo como precisión medida. La calidad necesita evaluación con fotografías reales etiquetadas; esta etapa no demuestra exactitud de clasificación.

## Flujo visual

1. Abrir `http://127.0.0.1:4174/nueva-incidencia.html` y adjuntar una fotografía.
2. Pulsar **Analizar fotografía**. Solo ese botón llama al proveedor. Durante la solicitud se bloquean clics duplicados y el envío del reporte.
3. Revisar la sugerencia original y el resumen. La descripción se completa si está vacía; se conserva texto escrito por el ciudadano. Categoría, tipo opcional y destino pueden corregirse con los controles existentes.
4. Confirmar ubicación y enviar usando el flujo existente. El análisis no sustituye las validaciones finales ni la carga definitiva de la imagen.
5. Cambiar la foto invalida el análisis y descarta respuestas tardías. Se limpia el texto generado sin borrar una descripción editada. Los cambios de ubicación, categoría o texto no llaman a IA.

Sin clave, error de red, rechazo o fotografía no reconocible, se informa el fallo y se mantiene el registro manual. No se crean clasificaciones ficticias.

## Pruebas

```powershell
node --test tests/*.test.cjs backend/tests/*.test.cjs
node --test backend/integration/vision-readonly.test.cjs
node tests/report-form-browser.cjs
```

Las llamadas al proveedor están simuladas. La integración de solo lectura consulta el catálogo y destino reales y rechaza cualquier sentencia que no sea SELECT. La prueba de navegador no envía reportes y usa una respuesta simulada explícita para IA.

Una única prueba real controlada, después de configurar la clave:

```powershell
node backend/scripts/test-vision-live.cjs
```

Envía una vez la fotografía de vías de `assets/images/home/vias.jpg`, sin crear registros. No forma parte de las pruebas automáticas; ejecutarla consume API. Si falta la clave, informa que queda pendiente sin llamar al proveedor.

## Alcance

El análisis es una sugerencia transitoria vinculada a la foto actual en el navegador. Esta etapa no escribe en `clasificacion_ia`, ni cambia el endpoint final, las tablas, los dashboards o los permisos. El registro final conserva los valores revisados por el ciudadano. La persistencia auditada de predicciones y su vinculación verificable a la fotografía final quedan para una etapa posterior. El backend sigue siendo un entorno local de pruebas, sin autenticación real para este endpoint.

Documentación utilizada: https://ai.google.dev/api/generate-content , https://ai.google.dev/gemini-api/docs/structured-output y https://ai.google.dev/gemini-api/docs/api-key .
