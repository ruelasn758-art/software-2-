# Recuperación por DNI y correo

1. En Ingresar, seleccionar Recuperar cuenta.
2. Escribir nombres, DNI, celular registrado y correo de contacto. No hace falta recordar el usuario.
3. El administrador entra en Usuarios y recuperación, abre Revisar DNI guardado y verifica la identidad. Debe confirmar el correo con el titular usando el celular que ya constaba en la cuenta; el DNI y un correo nuevo no bastan para autorizar un cambio.
4. Marca la confirmación y pulsa Aprobar y enviar enlace. El correo incluye el usuario y un enlace válido 30 minutos, de un solo uso. Reenviar invalida el anterior. Si falla Gmail, la solicitud continúa pendiente.
5. El ciudadano abre el enlace y elige una contraseña de al menos 8 caracteres.

La comparación del DNI y el celular localiza la cuenta. La fotografía guardada sirve para revisión humana; no se ha añadido reconocimiento biométrico ni validación automática de identidad.

## Activar Gmail

Remitente previsto: ruelasn758@gmail.com.

- Activar la verificación en dos pasos de esa cuenta de Google.
- Crear una contraseña de aplicación: https://myaccount.google.com/apppasswords
- Abrir configurar_correo.bat e introducir allí las 16 letras, ocultas en pantalla. No usar la contraseña personal ni compartirla en el chat.
- La configuración se guarda en private/correo/smtp.json, excluida de Git. No compartir ese archivo.
- Reiniciar iniciar_movil.bat para cargar el código nuevo. El enlace temporal cambiará; usar el nuevo enlace.
- El servidor debe continuar abierto. Reiniciar el túnel invalida la dirección de los correos anteriores; el administrador deberá reenviarlos.

El origen HTTPS se obtiene de ENLACE_MOVIL.txt. Si se despliega con dominio fijo, configurar public_url en smtp.json. Nunca se genera el enlace desde la cabecera Host enviada por un visitante.

Ayuda de Google: https://support.google.com/mail/answer/185833?hl=es

## Base de datos y pruebas

La migración database/03_recuperacion_correo.sql añade dos campos a notificacion y amplía la vista de compatibilidad; conserva las tablas y los datos existentes. Ya aplicada en la base local de este proyecto. Para otra instalación PostgreSQL, aplicar esta migración después de 02_integracion.sql.

Ejecutar .venv\Scripts\python.exe tests\verificar_recuperacion_correo.py para probar en SQLite temporal y con correo simulado. No se envían mensajes reales. También se comprobó la integración PostgreSQL con una transacción revertida.

El envío real requiere la contraseña de aplicación; no se ha comprobado la entrega a una bandeja real sin esa configuración.
