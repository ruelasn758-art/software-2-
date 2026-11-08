"""Recorrido por HTTP real: servidor local, cookies y multipart, sin sesión inyectada."""
import base64
import html
import re
import threading
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor
from uuid import uuid4

import pytest
from werkzeug.security import generate_password_hash
from werkzeug.serving import make_server
import app as sistema

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")

class Navegador:
    def __init__(self, base):
        self.base=base
        self.http=build_opener(HTTPCookieProcessor(CookieJar()))

    def pedir(self, path, campos=None, archivos=()):
        headers={}
        body=None
        if archivos:
            boundary="PunoTest"+uuid4().hex
            partes=[]
            for nombre,valor in (campos or {}).items():
                partes.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{nombre}"\r\n\r\n{valor}\r\n'.encode())
            for nombre,archivo in archivos:
                partes.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{nombre}"; filename="{archivo}"\r\nContent-Type: image/png\r\n\r\n'.encode()+PNG+b"\r\n")
            body=b"".join(partes)+f"--{boundary}--\r\n".encode()
            headers["Content-Type"]="multipart/form-data; boundary="+boundary
        elif campos is not None:
            body=urlencode(campos).encode()
            headers["Content-Type"]="application/x-www-form-urlencoded"
        try:
            with self.http.open(Request(self.base+path,data=body,headers=headers),timeout=15) as r:
                return r.status,r.geturl(),r.read().decode("utf-8")
        except HTTPError as e:
            return e.code,e.url,e.read().decode("utf-8")

    def entrar(self, usuario, clave):
        status,url,_=self.pedir("/ingresar",dict(usuario=usuario,clave=clave))
        assert status==200 and "/ingresar" not in url

@pytest.fixture
def servidor_http(cliente):
    # cliente configura una base desechable; ningún dato de producción se utiliza.
    cliente.get("/")
    clave="SoloPruebas-"+uuid4().hex
    with sistema.app.app_context():
        db=sistema.get_db()
        admin=db.execute("SELECT id,usuario FROM usuarios WHERE rol='administrador' LIMIT 1").fetchone()
        operador=db.execute("SELECT id,usuario,area_id FROM usuarios WHERE rol='operador' LIMIT 1").fetchone()
        categoria=db.execute("SELECT id,nombre FROM categorias WHERE area_id=? LIMIT 1",(operador["area_id"],)).fetchone()
        for uid in (admin["id"],operador["id"]):
            db.execute("UPDATE usuarios SET clave_hash=? WHERE id=?",(generate_password_hash(clave),uid))
        db.commit()
    server=make_server("127.0.0.1",0,sistema.app,threaded=True)
    hilo=threading.Thread(target=server.serve_forever,daemon=True)
    hilo.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}",dict(admin),dict(operador),dict(categoria),clave
    finally:
        server.shutdown()
        hilo.join(timeout=10)
        server.server_close()

def test_recorrido_http_real_con_base_y_roles(servidor_http):
    base,admin,operador,categoria,clave=servidor_http
    vecino=Navegador(base); gestor=Navegador(base); entidad=Navegador(base); ajeno=Navegador(base)
    nombre="Persona ficticia "+uuid4().hex[:8]
    usuario="vecino"+uuid4().hex
    datos=dict(nombre=nombre,usuario=usuario,dni=str(20000000+uuid4().int%70000000),
               telefono="999888777",direccion="Calle de prueba 123",clave=clave,clave2=clave)
    assert vecino.pedir("/registro",datos,[("dni_foto","prueba.png")])[0]==200
    # Registro pendiente: todavía no puede reportar.
    assert "/reportar" not in vecino.pedir("/reportar")[1]
    gestor.entrar(admin["usuario"],clave)
    status,_,lista=gestor.pedir("/admin/cuentas?vista=cuentas&q="+usuario)
    assert status==200 and usuario in lista
    uid=re.search(r'/admin/usuario/(\d+)',lista).group(1)
    status,_,ficha=gestor.pedir("/admin/usuario/"+uid)
    csrf=html.unescape(re.search(r'name="csrf_recuperacion" value="([^"]+)"',ficha).group(1))
    assert gestor.pedir("/admin/usuario/"+uid,dict(accion="verificar",csrf_recuperacion=csrf))[0]==200
    vecino.pedir("/salir")
    vecino.entrar(usuario,clave)
    status,url,pagina=vecino.pedir("/reportar",dict(descripcion="Incidencia ficticia para integración HTTP",
        referencia="Esquina de prueba",categoria_id=categoria["id"],lat="-15.8402",lng="-70.0219"),
        [("foto","incidencia.png"),("fotos_referencia","esquina.png"),("fotos_referencia","fachada.png")])
    assert status==200 and "/reporte/PR-" in url
    codigo=url.rsplit("/",1)[1]
    assert nombre in pagina and "Punto de referencia 2" in pagina
    entidad.entrar(operador["usuario"],clave)
    assert codigo in entidad.pedir("/alertas")[2]
    ruta="/municipalidad/reporte/"+codigo
    assert entidad.pedir(ruta,dict(accion="estado",estado="En proceso"))[0]==200
    assert entidad.pedir(ruta,dict(accion="evidencia"),[("fotografia","antes.png"),("fotografia","despues.png")])[0]==200
    assert entidad.pedir(ruta,dict(accion="estado",estado="Solucionado"))[0]==200
    final=vecino.pedir("/reporte/"+codigo)[2]
    assert "Solucionado" in final and nombre in final
    with sistema.app.app_context():
        data=sistema.reporte_completo(codigo)
        rid=data["reporte"]["id"]
        assert len(data["evidencias"])==2 and len(data["fotos_referencia"])==2
        assert any("Solucionado" in n["mensaje"] for n in data["notificaciones"])
        foto="/static/uploads/fotos/"+data["reporte"]["foto"]
        db=sistema.get_db()
        assert [r[0] for r in db.execute("SELECT usuario_id FROM alertas WHERE reporte_id=?",(rid,)).fetchall()]==[operador["id"]]
        if getattr(db,"postgres",False):
            assert db.execute("SELECT COUNT(*) FROM public.historial_estado WHERE id_reporte=?",(rid,)).fetchone()[0]==3
            assert db.execute("SELECT COUNT(*) FROM public.archivo_reporte WHERE id_reporte=?",(rid,)).fetchone()[0]==5
            assert db.execute("SELECT COUNT(*) FROM public.auditoria WHERE tabla_afectada='reporte' AND id_registro=?",(rid,)).fetchone()[0]>=3
    # El titular puede descargar el archivo real; un anónimo no.
    with vecino.http.open(base+foto,timeout=10) as imagen:
        assert imagen.status==200 and imagen.read()==PNG
    assert "/ingresar" in ajeno.pedir("/reporte/"+codigo)[1]
    assert ajeno.pedir(foto)[0]==401
    # La cuenta administradora no atiende incidencias ni ve la identidad del titular.
    assert nombre not in gestor.pedir("/reporte/"+codigo)[2]
