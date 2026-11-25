"""Arranque de Puno Reporta en Render (hosting gratuito y provisional).

Render borra los archivos locales cada vez que la aplicacion se reinicia o se
duerme, asi que no se puede leer private/security/cuentas-locales.txt.
Este archivo crea la base y fija las claves de "admin" y "operador" con las
variables de entorno CLAVE_ADMIN y CLAVE_OPERADOR configuradas en Render.

Comando de inicio en Render:  gunicorn render_app:app --workers 1 --threads 4
"""
import os
import sqlite3
from contextlib import closing

from werkzeug.security import generate_password_hash

import app as sistema

sistema.init_db()
sistema._db_ready = True

if not sistema.database_backend.configuracion():
    with closing(sqlite3.connect(sistema.DB_PATH)) as db:
        for usuario, variable in (("admin", "CLAVE_ADMIN"), ("operador", "CLAVE_OPERADOR")):
            clave = os.environ.get(variable, "").strip()
            if clave:
                db.execute(
                    "UPDATE usuarios SET clave_hash = ? WHERE usuario = ?",
                    (generate_password_hash(clave), usuario),
                )
        db.commit()

# Modo publico: Render ya sirve la pagina con HTTPS.
sistema.app.config.update(PUBLIC_TUNNEL=True, SESSION_COOKIE_SECURE=True)
app = sistema.app
