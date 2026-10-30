"""Enlace HTTPS temporal mediante Cloudflare, sin instalar nada en el telefono."""
from pathlib import Path
from contextlib import closing
import hashlib
import json
import os
import re
import secrets
import sqlite3
import subprocess
import threading
from urllib.request import Request, urlopen

from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.serving import make_server

import app as sistema

BASE = Path(__file__).resolve().parent


def preparar_cuentas():
    """Cambia solo claves conocidas de demostracion, guardando acceso local."""
    carpeta = BASE / "private" / "security"
    carpeta.mkdir(parents=True, exist_ok=True)
    if sistema.database_backend.configuracion():
        # La migracion conserva las claves existentes; no tocar el respaldo SQLite.
        with sistema.app.app_context():
            db = sistema.get_db()
            for usuario, demo in (("admin", "admin123"), ("operador", "opera123")):
                fila = db.execute('SELECT id, clave_hash FROM usuarios WHERE usuario = ?', (usuario,)).fetchone()
                if fila and check_password_hash(fila['clave_hash'], demo):
                    clave = secrets.token_urlsafe(18)
                    with (carpeta / 'cuentas-locales.txt').open('a', encoding='utf-8') as salida:
                        salida.write(f'\nUsuario: {usuario}\nClave: {clave}\n')
                    db.execute('UPDATE usuarios SET clave_hash = ? WHERE id = ?', (generate_password_hash(clave), fila['id']))
            db.commit()
        return
    with closing(sqlite3.connect(sistema.DB_PATH)) as db:
        cambios = []
        for usuario, demo in (("admin", "admin123"), ("operador", "opera123")):
            fila = db.execute("SELECT id, clave_hash FROM usuarios WHERE usuario = ?", (usuario,)).fetchone()
            if fila and check_password_hash(fila[1], demo):
                cambios.append((fila[0], usuario, secrets.token_urlsafe(18)))
        if not cambios:
            return
        backup = carpeta / f"respaldo-antes-tunel-{secrets.token_hex(4)}.db"
        with closing(sqlite3.connect(backup)) as copia:
            db.backup(copia)
        with (carpeta / "cuentas-locales.txt").open("a", encoding="utf-8") as salida:
            salida.write("\nClaves nuevas para las cuentas de demostracion (no compartir este archivo):\n")
            for uid, usuario, clave in cambios:
                salida.write(f"Usuario: {usuario}\nClave: {clave}\n\n")
                db.execute("UPDATE usuarios SET clave_hash = ? WHERE id = ?", (generate_password_hash(clave), uid))
        db.commit()
    print("Claves de demostracion reemplazadas. Consulta private/security/cuentas-locales.txt.", flush=True)


def obtener_cloudflared():
    carpeta = BASE / "private" / "tunnel"
    carpeta.mkdir(parents=True, exist_ok=True)
    exe = carpeta / "cloudflared.exe"
    checksum = carpeta / "cloudflared.sha256"
    if exe.exists() and checksum.exists():
        if hashlib.sha256(exe.read_bytes()).hexdigest() == checksum.read_text().strip():
            return exe
        raise RuntimeError("El archivo cloudflared no coincide con su verificacion. Revisa private/tunnel.")
    print("Descargando Cloudflare en la computadora (solo la primera vez)...", flush=True)
    req = Request("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", headers={"User-Agent": "PunoReporta-local", "Accept": "application/vnd.github+json"})
    with urlopen(req, timeout=60) as response:
        release = json.load(response)
    asset = next(a for a in release["assets"] if a["name"] == "cloudflared-windows-amd64.exe")
    digest = asset.get("digest", "")
    if not digest.startswith("sha256:"):
        raise RuntimeError("La descarga oficial no incluye SHA-256; no se ejecutara sin verificar.")
    with urlopen(asset["browser_download_url"], timeout=120) as response:
        datos = response.read()
    esperado = digest.split(":", 1)[1]
    if hashlib.sha256(datos).hexdigest() != esperado:
        raise RuntimeError("La descarga no coincide con el SHA-256 oficial.")
    exe.write_bytes(datos)
    checksum.write_text(esperado, encoding="ascii")
    return exe


def main():
    exe = obtener_cloudflared()
    sistema.init_db()
    sistema._db_ready = True
    preparar_cuentas()
    sistema.app.config.update(PUBLIC_TUNNEL=True, SESSION_COOKIE_SECURE=True)
    server = make_server("127.0.0.1", 0, sistema.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    proceso = None
    enlace = BASE / "ENLACE_MOVIL.txt"
    enlace.write_text("Conectando. Espera el enlace HTTPS en esta ventana.\n", encoding="utf-8")
    try:
        print("Preparando enlace HTTPS. Deja esta ventana abierta; Ctrl+C para apagarlo.", flush=True)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proceso = subprocess.Popen(
            [str(exe), "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", f"http://127.0.0.1:{server.server_port}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", creationflags=flags,
        )
        encontrado = False
        for linea in proceso.stdout:
            match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", linea)
            if match and match.group(0) != "https://api.trycloudflare.com" and not encontrado:
                encontrado = True
                url = match.group(0)
                enlace.write_text(f"Abre en tu telefono:\n{url}\n\nDeja iniciar_movil.bat abierto. Al reiniciarlo, el enlace cambia.\n", encoding="utf-8")
                print(f"\nABRE EN TU TELEFONO: {url}\nNo necesitas instalar certificados ni aplicaciones.\n", flush=True)
            if "Registered tunnel connection" in linea:
                print("Enlace conectado. Ya puedes abrirlo e iniciar sesion.", flush=True)
            elif "ERR" in linea or "failed" in linea.lower():
                print(linea.strip(), flush=True)
        codigo = proceso.wait()
        raise RuntimeError(f"El tunel se cerro (codigo {codigo}). Revisa tu conexion y vuelve a iniciar.")
    except KeyboardInterrupt:
        print("\nCerrando el acceso movil...", flush=True)
    finally:
        if proceso and proceso.poll() is None:
            proceso.terminate()
            try:
                proceso.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proceso.kill()
                proceso.wait()
        server.shutdown()
        server.server_close()
        enlace.write_text("El enlace esta apagado. Abre iniciar_movil.bat para generar uno nuevo.\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"No se pudo abrir el enlace: {error}", flush=True)
        raise SystemExit(1)
