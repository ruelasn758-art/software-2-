import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
import pytest
from werkzeug.security import generate_password_hash
import app as sistema

@pytest.fixture(scope="session")
def pg_desde_cero(tmp_path_factory):
    config_path=os.environ.get("PUNO_TEST_PG_CONFIG")
    if not config_path:
        pytest.skip("PostGIS opcional: indica PUNO_TEST_PG_CONFIG para crear una base desechable.")
    admin=json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
    nombre="puno_pytest_"+uuid4().hex
    with psycopg.connect(**admin,autocommit=True) as control:
        control.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(nombre)))
        try:
            config={**admin,"dbname":nombre}
            with psycopg.connect(**config) as db:
                for p in sorted((sistema.BASE_DIR/"database").glob("[0-9]*.sql")):
                    db.execute(p.read_text(encoding="utf-8-sig"))
                for rol,codigo,usuario,area in [("administrador","A","admin",None),("operador","O","operador",1)]:
                    db.execute("INSERT INTO compat.usuarios(rol,codigo,usuario,nombre,dni,clave_hash,estado,area_id) VALUES(%s,%s,%s,%s,%s,%s,'Verificado',%s)",
                               (rol,codigo,usuario,"Persona de prueba","12345671" if area else "12345672",generate_password_hash("solo-pruebas"),area))
            ruta=tmp_path_factory.mktemp("pg")/"conexion.json"
            ruta.write_text(json.dumps(config),encoding="utf-8")
            yield ruta
        finally:
            control.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(nombre)))

@pytest.fixture(params=["sqlite",pytest.param("postgres",marks=pytest.mark.postgres)])
def cliente(request,tmp_path,monkeypatch):
    motor=request.param
    monkeypatch.setenv("PUNO_DB_BACKEND",motor)
    if motor=="postgres":
        ruta=request.getfixturevalue("pg_desde_cero")
        monkeypatch.setenv("PUNO_PG_CONFIG",str(ruta))
    monkeypatch.setattr(sistema,"DB_PATH",tmp_path/"prueba.db")
    # La carpeta estática y los archivos subidos deben pertenecer al mismo entorno
    # para comprobar también la descarga real de adjuntos autorizados.
    monkeypatch.setattr(sistema.app,"static_folder",str(tmp_path/"static"))
    monkeypatch.setattr(sistema,"UPLOAD_DNI",tmp_path/"private"/"dni")
    monkeypatch.setattr(sistema,"UPLOAD_EVIDENCIAS",tmp_path/"static"/"uploads"/"evidencias")
    monkeypatch.setattr(sistema,"UPLOAD_FOTOS",tmp_path/"static"/"uploads"/"fotos")
    monkeypatch.setattr(sistema,"_db_ready",False)
    monkeypatch.setitem(sistema.app.config,"TESTING",True)
    monkeypatch.setitem(sistema.app.config,"PUBLIC_TUNNEL",False)
    return sistema.app.test_client()
