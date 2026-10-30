"""Crea el esquema solicitado y migra SQLite sin modificar el archivo original."""
from contextlib import closing
from datetime import datetime
import json
from pathlib import Path
import secrets
import sqlite3
import sys

import psycopg
from psycopg import sql

BASE = Path(__file__).resolve().parents[1]
PRIV = BASE / 'private' / 'postgres'
DBNAME = 'puno_reporta'
APPUSER = 'puno_reporta_app'


def migrar(conn, origen):
    origen.row_factory = sqlite3.Row
    filas = lambda tabla: [dict(r) for r in origen.execute(f'SELECT * FROM {tabla} ORDER BY id')]
    usuarios, reportes = filas('usuarios'), filas('reportes')
    areas = {r['id']: conn.execute('SELECT id_area FROM area_entidad WHERE codigo=%s', (r['codigo'],)).fetchone()[0] for r in filas('areas')}
    categorias = {r['id']: conn.execute('SELECT id_categoria FROM categoria WHERE codigo=%s', (r['codigo'],)).fetchone()[0] for r in filas('categorias')}
    roles = {'ciudadano':1,'operador':2,'administrador':4}
    for u in usuarios:
        conn.execute('''INSERT INTO usuario(id_usuario,id_rol,nombres,apellidos,dni,correo,password_hash,telefono,activo,fecha_registro,codigo,usuario,dni_foto,direccion,referencia,estado_verificacion,motivo,verificado_en)
          OVERRIDING SYSTEM VALUE VALUES(%s,%s,%s,'',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
          (u['id'],roles[u['rol']],u['nombre'],u['dni'],f"migrado-{u['id']}@puno.invalid",u['clave_hash'],u['telefono'],u['estado']!='Suspendido',u['creado_en'],u['codigo'],u['usuario'],u['dni_foto'],u['direccion'],u['referencia'],u['estado'],u['motivo'],u['verificado_en']))
        if u['area_id']:
            conn.execute('INSERT INTO usuario_area(id_usuario,id_area) VALUES(%s,%s)', (u['id'],areas[u['area_id']]))
    conn.execute("SELECT setval(pg_get_serial_sequence('usuario','id_usuario'),COALESCE((SELECT max(id_usuario) FROM usuario),1),EXISTS(SELECT 1 FROM usuario))")
    historico = None
    if any(not r.get('usuario_id') for r in reportes):
        historico = conn.execute("INSERT INTO usuario(id_rol,nombres,apellidos,correo,password_hash,activo,estado_verificacion,usuario) VALUES(1,'Reportante historico','','historico@puno.invalid','!sin-acceso',false,'Suspendido','historico-importado') RETURNING id_usuario").fetchone()[0]
    dueños = {}
    for r in reportes:
        categoria = categorias[r['categoria_id']]
        tipo = conn.execute('SELECT min(id_tipo_incidencia) FROM tipo_incidencia WHERE id_categoria=%s',(categoria,)).fetchone()[0]
        estado = conn.execute('SELECT id_estado FROM estado_reporte WHERE nombre=%s',(r['estado'],)).fetchone()[0]
        uid = r.get('usuario_id') or historico
        dueños[r['id']] = uid
        conn.execute('''INSERT INTO reporte(id_reporte,codigo,id_usuario,id_categoria,id_tipo_incidencia,id_area_responsable,id_estado,descripcion,ubicacion,origen_ubicacion,fecha_registro,fecha_actualizacion,ciudadano_nombre,ciudadano_contacto,referencia,direccion_mapa,verificado_sitio,operador_id)
         OVERRIDING SYSTEM VALUE VALUES(%s,%s,%s,%s,%s,%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,'MANUAL',%s,%s,%s,%s,%s,%s,%s,%s)''',
         (r['id'],r['codigo'],uid,categoria,tipo,areas[r['area_id']],estado,r['descripcion'],r['lng'],r['lat'],r['creado_en'],r['creado_en'],r['ciudadano_nombre'],r['ciudadano_contacto'],r.get('referencia'),r.get('direccion_mapa'),r.get('verificado_sitio',0),r.get('operador_id')))
        conn.execute("INSERT INTO archivo_reporte(id_reporte,tipo_archivo,ruta_archivo,fecha_registro) VALUES(%s,'INCIDENCIA',%s,%s)",(r['id'],r['foto'],r['creado_en']))
        conn.execute("UPDATE historial_estado SET observacion='Importacion del estado actual desde SQLite; no representa un historial anterior.' WHERE id_reporte=%s",(r['id'],))
    conn.execute("SELECT setval(pg_get_serial_sequence('reporte','id_reporte'),COALESCE((SELECT max(id_reporte) FROM reporte),1),EXISTS(SELECT 1 FROM reporte))")
    for e in filas('evidencias'):
        conn.execute("INSERT INTO archivo_reporte(codigo,id_reporte,tipo_archivo,ruta_archivo,fecha_registro) VALUES(%s,%s,'SOLUCION',%s,to_date(%s,'DD/MM/YYYY'))",(e['codigo'],e['reporte_id'],e['fotografia'],e['fecha']))
    for n in filas('notificaciones'):
        conn.execute("INSERT INTO notificacion(codigo,id_usuario,id_reporte,titulo,mensaje,clase,estado_envio,fecha_creacion) VALUES(%s,%s,%s,'Actualizacion del reporte',%s,'REPORTE',%s,%s)",(n['codigo'],dueños[n['reporte_id']],n['reporte_id'],n['mensaje'],n['estado'],n['creado_en']))
    for a in filas('alertas'):
        conn.execute("INSERT INTO notificacion(id_usuario,id_reporte,titulo,mensaje,clase,leida,fecha_creacion) VALUES(%s,%s,'Aviso de Puno Reporta',%s,'ALERTA',%s,%s)",(a['usuario_id'],a['reporte_id'],a['mensaje'],bool(a['leida']),a['creado_en']))
    for r in filas('recuperaciones'):
        conn.execute("INSERT INTO notificacion(codigo,id_usuario,titulo,mensaje,clase,estado_recuperacion,codigo_clave,fecha_creacion,resuelto_en) VALUES(%s,%s,'Recuperacion de cuenta','Solicitud de recuperacion','RECUPERACION',%s,%s,%s,%s)",(r['codigo'],r['usuario_id'],r['estado'],r['codigo_clave'],r['creado_en'],r['resuelto_en']))
    for tabla in ('reportes','evidencias','notificaciones','alertas','recuperaciones'):
        anterior = origen.execute(f'SELECT count(*) FROM {tabla}').fetchone()[0]
        nuevo = conn.execute(sql.SQL('SELECT count(*) FROM compat.{}').format(sql.Identifier(tabla))).fetchone()[0]
        if anterior != nuevo:
            raise RuntimeError(f'No coincide el conteo de {tabla}: {anterior}/{nuevo}')
        print(f'{tabla}: {nuevo} registros conservados')


def main():
    admin=json.loads((PRIV/'admin.json').read_text(encoding='utf-8-sig'))
    with psycopg.connect(**admin,autocommit=True) as control:
        if not control.execute("SELECT 1 FROM pg_available_extensions WHERE name='postgis'").fetchone():
            raise RuntimeError('PostGIS no esta instalado en PostgreSQL 18.')
        if not control.execute('SELECT 1 FROM pg_database WHERE datname=%s',(DBNAME,)).fetchone():
            control.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(DBNAME)))
    destino={**admin,'dbname':DBNAME}
    with psycopg.connect(**destino) as conn:
        existe=conn.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'spatial_ref_sys'").fetchone()[0]
        if existe:
            raise RuntimeError('La base puno_reporta ya contiene tablas. No se sobrescribira; revisa antes de repetir la migracion.')
        source=BASE/'puno_reporta.db'
        backup=PRIV/f"respaldo-sqlite-{datetime.now():%Y%m%d-%H%M%S}.db"
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as origen:
            with closing(sqlite3.connect(backup)) as copia:
                origen.backup(copia)
            for filename in ('01_tablas.sql','02_integracion.sql'):
                conn.execute((BASE/'database'/filename).read_text(encoding='utf-8'))
            migrar(conn,origen)
        apppass=secrets.token_urlsafe(32)
        if conn.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(APPUSER,)).fetchone():
            raise RuntimeError('El usuario de servicio ya existe; no se cambiara su clave automaticamente.')
        conn.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(APPUSER),sql.Literal(apppass)))
        conn.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(DBNAME),sql.Identifier(APPUSER)))
        conn.execute(sql.SQL('GRANT USAGE ON SCHEMA public, compat TO {}').format(sql.Identifier(APPUSER)))
        conn.execute(sql.SQL('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,compat TO {}').format(sql.Identifier(APPUSER)))
        conn.execute(sql.SQL('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {}').format(sql.Identifier(APPUSER)))
        conn.execute(sql.SQL('ALTER ROLE {} IN DATABASE {} SET search_path TO compat,public').format(sql.Identifier(APPUSER),sql.Identifier(DBNAME)))
        conn.execute("COMMENT ON DATABASE puno_reporta IS 'PUNO REPORTA: esquema de 16 tablas, migracion desde SQLite' ")
        config={**destino,'user':APPUSER,'password':apppass}
        (PRIV/'conexion-pendiente.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
        conn.commit()
    print('Migracion confirmada. Conexion pendiente de pruebas antes de activarla.')


if __name__=='__main__':
    main()
