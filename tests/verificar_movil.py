"""Prueba aislada: no modifica la base de datos del proyecto."""
import os
os.environ['PUNO_DB_BACKEND'] = 'sqlite'
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as modulo
from https_local import preparar_https
from werkzeug.serving import make_server


def main():
    with tempfile.TemporaryDirectory(prefix="puno-mobile-test-") as temp:
        base = Path(temp).resolve()
        assert base.is_relative_to(Path(tempfile.gettempdir()).resolve())
        modulo.DB_PATH = base / "test.db"
        modulo.UPLOAD_FOTOS = base / "fotos"
        modulo.UPLOAD_EVIDENCIAS = base / "evidencias"
        modulo.UPLOAD_DNI = base / "dni"
        modulo.init_db()
        modulo._db_ready = True
        with modulo.app.app_context():
            db = modulo.get_db()
            db.execute("INSERT INTO usuarios (codigo,rol,usuario,clave_hash,nombre,estado,creado_en) VALUES ('TEST','ciudadano','prueba','unused','Ciudadano de prueba','Verificado','2026-01-01')")
            uid = db.execute("SELECT id FROM usuarios WHERE codigo='TEST'").fetchone()[0]
            db.execute("UPDATE usuarios SET telefono='999000000' WHERE id=?", (uid,))
            db.commit()
        cert, key, _ = preparar_https(base)
        server = make_server("127.0.0.1", 0, modulo.app, ssl_context=(cert, key), threaded=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"https://127.0.0.1:{server.server_port}"
        try:
            context = ssl.create_default_context(cafile=str(base / "private/https/puno-reporta-local.crt"))
            with urlopen(url, context=context) as response:
                assert response.status == 200
            print("HTTPS comprobado con validacion real de CA e IP.", flush=True)
            env = os.environ.copy()
            env["MOBILE_TEST_URL"] = url
            env["MOBILE_TEST_COOKIE"] = modulo.app.session_interface.get_signing_serializer(modulo.app).dumps({"usuario_id": uid})
            script = os.environ.get("MOBILE_BROWSER_TEST", str(Path(__file__).with_suffix('.cjs')))
            subprocess.run(["node", script], env=env, check=True)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
