"""Prueba real en un clon desechable; nunca escribe en la base del usuario."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from uuid import uuid4
import psycopg
from psycopg import sql

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
PRIV = BASE / 'private/postgres'

def main():
    admin = json.loads((PRIV/'admin.json').read_text(encoding='utf-8-sig'))
    config = json.loads((PRIV/'conexion-pendiente.json').read_text())
    nombre = 'puno_prueba_' + uuid4().hex[:12]
    anterior = hashlib.sha256((BASE/'puno_reporta.db').read_bytes()).hexdigest()
    with psycopg.connect(**admin, autocommit=True) as control:
        control.execute(sql.SQL('CREATE DATABASE {} TEMPLATE puno_reporta').format(sql.Identifier(nombre)))
        try:
            with tempfile.TemporaryDirectory(dir=PRIV, prefix='prueba-') as temp:
                carpeta = Path(temp)
                archivo = carpeta/'conexion.json'
                archivo.write_text(json.dumps({**config,'dbname':nombre}))
                os.environ['PUNO_PG_CONFIG'] = str(archivo)
                os.environ['PUNO_DB_BACKEND'] = 'postgres'
                import app as sistema
                for attr in ('UPLOAD_DNI','UPLOAD_FOTOS','UPLOAD_EVIDENCIAS'):
                    ruta=carpeta/attr
                    ruta.mkdir()
                    setattr(sistema,attr,ruta)
                sistema.app.config.update(TESTING=True, PUBLIC_TUNNEL=False)
                sistema.init_db()
                cliente=sistema.app.test_client()
                assert cliente.get('/').status_code==200
                respuesta=cliente.post('/registro',data=dict(nombre='Persona Prueba',usuario='pruebapg',dni='87654321',telefono='999888777',direccion='Direccion de prueba Puno',clave='Prueba123!',clave2='Prueba123!',dni_foto=(io.BytesIO(b'prueba'),'dni.png')))
                assert respuesta.status_code==302, respuesta.status_code
                with sistema.app.app_context():
                    db=sistema.get_db()
                    uid=db.execute("SELECT id FROM usuarios WHERE usuario='pruebapg'").fetchone()[0]
                    aid=db.execute("SELECT id FROM usuarios WHERE rol='administrador' LIMIT 1").fetchone()[0]
                with cliente.session_transaction() as ses:
                    ses['usuario_id']=aid
                    ses['rol']='administrador'
                for ruta in ('/panel','/admin/cuentas','/alertas',f'/admin/usuario/{uid}'):
                    assert cliente.get(ruta).status_code==200,ruta
                assert cliente.post(f'/admin/usuario/{uid}',data={'accion':'verificar'}).status_code==302
                with cliente.session_transaction() as ses:
                    ses.clear()
                assert cliente.post('/ingresar',data={'usuario':'pruebapg','clave':'Prueba123!'}).status_code==302
                for ruta in ('/perfil','/mis-reportes','/reportar','/mapa','/api/reportes'):
                    assert cliente.get(ruta).status_code==200,ruta
                assert sistema.ubicacion_valida(-12.0464,-77.0428)
                for lat,lng in [(91,0),(0,181),(float('nan'),0),(0,float('inf'))]:
                    assert not sistema.ubicacion_valida(lat,lng)
                respuesta=cliente.post('/reportar',data=dict(descripcion='Bache de prueba de integracion PostgreSQL',categoria_id='1',lat='-12.0464',lng='-77.0428',foto=(io.BytesIO(b'prueba'),'bache.png')))
                assert respuesta.status_code==302,respuesta.status_code
                assert '/reporte/' in respuesta.location,respuesta.location
                codigo=respuesta.location.rsplit('/',1)[1]
                assert cliente.get(respuesta.location).status_code==200
                with cliente.session_transaction() as ses:
                    ses['usuario_id']=aid
                    ses['rol']='administrador'
                ruta=f'/municipalidad/reporte/{codigo}'
                assert cliente.get(ruta).status_code==200
                assert cliente.post(ruta,data={'accion':'estado','estado':'En proceso'}).status_code==302
                assert cliente.post(ruta,data={'accion':'evidencia','fotografia':(io.BytesIO(b'prueba'),'solucion.png')}).status_code==302
                assert cliente.post(ruta,data={'accion':'estado','estado':'Solucionado'}).status_code==302
                assert cliente.post('/alertas/leer-todas').status_code==302
                with sistema.app.app_context():
                    db=sistema.get_db()
                    rid=db.execute('SELECT id FROM reportes WHERE codigo=?',(codigo,)).fetchone()[0]
                    assert db.execute('SELECT count(*) FROM public.historial_estado WHERE id_reporte=?',(rid,)).fetchone()[0]==3
                    assert db.execute('SELECT count(*) FROM public.archivo_reporte WHERE id_reporte=?',(rid,)).fetchone()[0]==2
                    assert db.execute('SELECT count(*) FROM public.auditoria').fetchone()[0]>0
                    assert db.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'spatial_ref_sys'").fetchone()[0]==16
                cliente.get('/salir')
                assert cliente.post('/recuperar',data={'usuario':'pruebapg','dni':'87654321','telefono':'999888777'}).status_code==302
                assert hashlib.sha256((BASE/'puno_reporta.db').read_bytes()).hexdigest()==anterior
                print('OK: 16 tablas, registro, login, verificacion, pantallas, reporte, evidencia, estados, notificaciones, historial, auditoria, recuperacion y SQLite intacto.')
        finally:
            control.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(nombre)))

if __name__=='__main__':
    main()
