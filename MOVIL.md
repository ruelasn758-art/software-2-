# Acceso desde el telefono sin instalar archivos

1. En la computadora abre **iniciar_movil.bat**.
2. La primera vez descarga Cloudflare desde su repositorio oficial y verifica su SHA-256. No necesitas cuenta ni dominio.
3. Espera **Enlace conectado**. Abre la direccion `https://...trycloudflare.com` en el telefono. Tambien queda en **ENLACE_MOVIL.txt**.
4. Ingresa con tu cuenta ciudadana verificada, abre Reportar y permite la ubicacion. Activa la ubicacion precisa del telefono.
5. Deja la computadora encendida y la ventana abierta. Ctrl+C detiene el acceso.

No necesitas certificados, otra aplicacion ni el mismo Wi-Fi. Ambos dispositivos necesitan internet. Puedes quitar la CA local anterior de las credenciales del telefono; este metodo no la usa.

El enlace cambia al reiniciar. Cloudflare Quick Tunnels es temporal para pruebas, sin garantia de disponibilidad. La pagina de inicio y el registro son accesibles desde internet; los reportes y fotos requieren iniciar sesion en este modo. El trafico pasa por Cloudflare.

Al activar el modo movil se reemplazan solo las contrasenas predeterminadas de admin y operador, si aun las usaban. Las nuevas estan en **private/security/cuentas-locales.txt**, junto a un respaldo previo de la base. Las cuentas ciudadanas conservan sus claves. No compartas la carpeta private.

En PC puedes seguir usando **iniciar.bat** y http://127.0.0.1:5000. El diseno y los colores se mantienen.

Si no abre el enlace, verifica la ventana y la conexion a internet. Si tu red bloquea Cloudflare, prueba otra red. No necesitas abrir puertos en el router.

Documentacion: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
