"""Comprobaciones con una base temporal, sin publicar datos de prueba."""
from pathlib import Path
import os
os.environ['PUNO_DB_BACKEND'] = 'sqlite'
from contextlib import closing
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import acceso_movil as movil
import app as sistema
from werkzeug.security import check_password_hash, generate_password_hash


def main():
    raiz = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(dir=raiz, prefix="tunel-test-") as temporal:
        base = Path(temporal).resolve()
        assert base.is_relative_to(raiz)
        movil.BASE = base
        sistema.DB_PATH = base / "test.db"
        sistema.UPLOAD_FOTOS = base / "fotos"
        sistema.UPLOAD_EVIDENCIAS = base / "evidencias"
        sistema.UPLOAD_DNI = base / "dni"
        sistema.init_db()
        sistema._db_ready = True
        movil.preparar_cuentas()
        with closing(sqlite3.connect(sistema.DB_PATH)) as db:
            assert not check_password_hash(db.execute("SELECT clave_hash FROM usuarios WHERE usuario='admin'").fetchone()[0], 'admin123')
            assert not check_password_hash(db.execute("SELECT clave_hash FROM usuarios WHERE usuario='operador'").fetchone()[0], 'opera123')
            db.execute("UPDATE usuarios SET clave_hash=? WHERE usuario='admin'", (generate_password_hash('clave-de-prueba'),))
            db.commit()
        archivo = base / 'private/security/cuentas-locales.txt'
        anterior = archivo.read_bytes()
        movil.preparar_cuentas()
        assert archivo.read_bytes() == anterior
        assert len(list((base / 'private/security').glob('respaldo-*.db'))) == 1
        sistema.app.config.update(TESTING=True, PUBLIC_TUNNEL=True, SESSION_COOKIE_SECURE=True)
        client = sistema.app.test_client()
        origin = {'Origin': 'https://example.test'}
        host = {'base_url': 'https://example.test'}
        assert client.get('/', **host).status_code == 200
        assert client.get('/api/reportes', **host).status_code == 401
        assert client.get('/static/uploads/fotos/test.png', **host).status_code == 401
        assert client.get('/reporte/PR-2026-0001', **host).status_code == 302
        assert client.post('/ingresar', data={'usuario':'admin','clave':'clave-de-prueba'}, headers={'Origin':'https://otro.test'}, **host).status_code == 403
        response = client.post('/ingresar', data={'usuario':'admin','clave':'clave-de-prueba','siguiente':'//otro.test'}, headers=origin, **host)
        assert response.status_code == 302 and response.location.startswith('/inicio')
        assert 'Secure;' in response.headers['Set-Cookie']
        assert client.get('/admin/cuentas', **host).status_code == 200
        with closing(sqlite3.connect(sistema.DB_PATH)) as db:
            db.execute("UPDATE usuarios SET estado='Suspendido' WHERE usuario='admin'")
            db.commit()
        assert client.get('/admin/cuentas', **host).status_code == 302
        assert client.get('/api/reportes', **host).status_code == 401
        print('OK: respaldo, rotacion de claves, idempotencia, acceso anonimo bloqueado, origen de formularios, cookies HTTPS, redirecciones y suspension.')


if __name__ == '__main__':
    main()
