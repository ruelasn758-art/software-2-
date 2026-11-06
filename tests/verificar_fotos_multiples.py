"""Prueba aislada de adjuntos multiples, sin modificar datos reales."""
import os, sys, tempfile
from pathlib import Path
from io import BytesIO
os.environ['PUNO_DB_BACKEND']='sqlite'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app as m

def foto(name): return (BytesIO(b'foto de prueba'),name)
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)
    m.DB_PATH=root/'test.db'
    m.UPLOAD_FOTOS=root/'fotos';m.UPLOAD_EVIDENCIAS=root/'evidencias';m.UPLOAD_DNI=root/'dni'
    m.init_db();m._db_ready=True;m.app.config['TESTING']=True
    with m.app.app_context():
        db=m.get_db()
        db.execute("INSERT INTO usuarios(codigo,rol,usuario,clave_hash,nombre,telefono,estado,creado_en) VALUES('TEST','ciudadano','test','unused','Prueba','999000000','Verificado','2026-01-01')")
        uid=db.execute("SELECT id FROM usuarios WHERE codigo='TEST'").fetchone()[0]
        admin=db.execute("SELECT id FROM usuarios WHERE rol='administrador' LIMIT 1").fetchone()[0]
        op,area=db.execute("SELECT id,area_id FROM usuarios WHERE rol='operador' LIMIT 1").fetchone()
        cat=db.execute('SELECT id FROM categorias WHERE area_id=? LIMIT 1',(area,)).fetchone()[0];db.commit()
    c=m.app.test_client()
    with c.session_transaction() as s:s['usuario_id']=uid
    data={'descripcion':'Una incidencia de prueba','categoria_id':str(cat),'lat':'-15.8','lng':'-70','foto':foto('principal.jpg'),'fotos_referencia':[foto('esquina.jpg'),foto('tienda.png')]}
    r=c.post('/reportar',data=data);assert r.status_code==302,r.status_code
    url=r.location
    with m.app.app_context():
        db=m.get_db();rep=db.execute('SELECT * FROM reportes ORDER BY id DESC LIMIT 1').fetchone();code=rep['codigo'];rid=rep['id']
        assert len(m.listar_referencias(rid))==2
    assert c.get(url).data.count(b'alt="Punto de referencia ')==2
    with c.session_transaction() as s:s['usuario_id']=admin
    route='/municipalidad/reporte/'+code
    home=c.get('/inicio',follow_redirects=True)
    assert home.request.path=='/admin/cuentas' and b'href="/alertas"' not in home.data
    assert c.get('/alertas',follow_redirects=True).request.path=='/admin/cuentas'
    assert c.get(route,follow_redirects=True).request.path=='/admin/cuentas'
    with m.app.app_context():
        assert [r[0] for r in m.get_db().execute("SELECT usuario_id FROM alertas WHERE reporte_id=?", (rid,)).fetchall()]==[op]
    with c.session_transaction() as s:s['usuario_id']=op
    r=c.post(route,data={'accion':'evidencia','fotografia':[foto('antes.jpg'),foto('despues.png')]});assert r.status_code==302
    with m.app.app_context():assert len(m.reporte_completo(code)['evidencias'])==2
    assert c.get(route).data.count(b'alt="Punto de referencia ')==2
    c.post(route,data={'accion':'evidencia','fotografia':[foto('valida.jpg'),foto('invalida.txt')]})
    with m.app.app_context():assert len(m.reporte_completo(code)['evidencias'])==2
    assert len(list(m.UPLOAD_EVIDENCIAS.iterdir()))==2
    assert code.encode() in c.get('/alertas').data
    with c.session_transaction() as s:s['usuario_id']=admin
    gestion=c.get('/admin/cuentas?vista=cuentas&q=operador&rol=operador')
    assert gestion.status_code==200 and b'Cuentas (1)' in gestion.data
    assert b'Cuentas (0)' in c.get('/admin/cuentas?vista=cuentas&q=operador&rol=ciudadano').data
    with c.session_transaction() as s:csrf=s['csrf_recuperacion']
    with m.app.app_context():otra=m.get_db().execute('SELECT id FROM areas WHERE id<>? LIMIT 1',(area,)).fetchone()[0]
    path='/admin/usuario/'+str(op)
    assert c.post(path,data={'accion':'editar','nombre':'Entidad de prueba','telefono':'999000111','area_id':otra,'csrf_recuperacion':csrf}).status_code==302
    with c.session_transaction() as s:s['usuario_id']=op
    assert code.encode() not in c.get('/alertas').data
    assert c.get(route).status_code==302
    with c.session_transaction() as s:s['usuario_id']=admin
    for accion,estado in [('suspender','Suspendido'),('reactivar','Verificado')]:
        c.post(path,data={'accion':accion,'csrf_recuperacion':csrf})
        with m.app.app_context():assert m.get_db().execute('SELECT estado FROM usuarios WHERE id=?',(op,)).fetchone()[0]==estado
print('OK: 2 referencias, 2 evidencias, visualizacion y rechazo de lote invalido.')
