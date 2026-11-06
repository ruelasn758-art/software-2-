from io import BytesIO
from uuid import uuid4
import pytest
import app as m

def sesion(c,uid):
    with c.session_transaction() as s:
        s.clear()
        s["usuario_id"]=uid

@pytest.fixture
def caso(cliente):
    c=cliente
    n=uuid4().int
    usuario=f"vecino{n:x}"
    respuesta=c.post("/registro",data=dict(nombre="Vecino de prueba",usuario=usuario,dni=str(20000000+n%70000000),telefono="999888777",direccion="Calle de prueba 123",clave="Prueba123!",clave2="Prueba123!",dni_foto=(BytesIO(b"prueba"),"documento.png")))
    assert respuesta.status_code==302
    with m.app.app_context():
        db=m.get_db()
        uid=db.execute("SELECT id FROM usuarios WHERE usuario=?",(usuario,)).fetchone()[0]
        admin=db.execute("SELECT id FROM usuarios WHERE rol='administrador' LIMIT 1").fetchone()[0]
        operador=db.execute("SELECT id,area_id FROM usuarios WHERE rol='operador' LIMIT 1").fetchone()
        op,area=operador["id"],operador["area_id"]
        cat=db.execute("SELECT id FROM categorias WHERE area_id=? LIMIT 1",(area,)).fetchone()[0]
    sesion(c,admin)
    c.get(f"/admin/usuario/{uid}")
    with c.session_transaction() as s: csrf=s["csrf_recuperacion"]
    assert c.post(f"/admin/usuario/{uid}",data={"accion":"verificar","csrf_recuperacion":csrf}).status_code==302
    c.get("/salir")
    assert c.post("/ingresar",data={"usuario":usuario,"clave":"Prueba123!"}).status_code==302
    r=c.post("/reportar",data=dict(descripcion="Bache en la calle de prueba",categoria_id=str(cat),lat="-15.8402",lng="-70.0219",foto=(BytesIO(b"prueba"),"bache.png")))
    assert r.status_code==302 and "/reporte/" in r.location
    return c,uid,op,r.location.rsplit("/",1)[1]

def test_registro_reporte_y_consulta(caso):
    c,uid,op,codigo=caso
    assert b"Vecino de prueba" in c.get("/reporte/"+codigo).data
    assert c.get("/consultar",query_string={"codigo":codigo}).location.endswith(codigo)

def test_atencion_por_area_y_evidencia(caso):
    c,uid,op,codigo=caso
    sesion(c,op)
    assert codigo.encode() in c.get("/alertas").data
    ruta="/municipalidad/reporte/"+codigo
    for accion,datos in [("estado",{"estado":"En proceso"}),("evidencia",{"fotografia":(BytesIO(b"prueba"),"atencion.png")}),("estado",{"estado":"Solucionado"})]:
        assert c.post(ruta,data={"accion":accion,**datos}).status_code==302
    with m.app.app_context():
        data=m.reporte_completo(codigo)
        assert data["reporte"]["estado"]=="Solucionado" and len(data["evidencias"])==1
        db=m.get_db()
        if getattr(db,"postgres",False):
            rid=data["reporte"]["id"]
            assert db.execute("SELECT COUNT(*) FROM public.historial_estado WHERE id_reporte=?",(rid,)).fetchone()[0]==3
            assert db.execute("SELECT COUNT(*) FROM public.archivo_reporte WHERE id_reporte=?",(rid,)).fetchone()[0]==2

def test_codigo_no_expone_identidad(caso):
    c,uid,op,codigo=caso
    with m.app.app_context():
        foto=m.reporte_completo(codigo)["reporte"]["foto"]
        admin=m.get_db().execute("SELECT id FROM usuarios WHERE rol='administrador' LIMIT 1").fetchone()[0]
    sesion(c,admin)
    pagina=c.get("/reporte/"+codigo)
    assert pagina.status_code==200 and b"Vecino de prueba" not in pagina.data and foto.encode() not in pagina.data
    assert c.get("/static/uploads/fotos/"+foto).status_code==404
    c.get("/salir")
    assert c.get("/reporte/"+codigo).status_code==302
    assert c.get("/static/uploads/fotos/"+foto).status_code==401
