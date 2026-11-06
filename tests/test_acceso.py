import pytest
import app as m

@pytest.mark.parametrize("tunel",[False,True])
@pytest.mark.parametrize("ruta,esperado",[("/api/reportes",401),("/static/uploads/fotos/prueba.png",401),("/reporte/PR-2026-0001",302)])
def test_acceso_anonimo(cliente,monkeypatch,tunel,ruta,esperado):
    monkeypatch.setitem(m.app.config,"PUBLIC_TUNNEL",tunel)
    assert cliente.get(ruta).status_code==esperado

def test_tunel_rechaza_otro_origen(cliente,monkeypatch):
    monkeypatch.setitem(m.app.config,"PUBLIC_TUNNEL",True)
    assert cliente.post("/ingresar",headers={"Origin":"https://otro.test"}).status_code==403

def test_cookie_segura_en_https(cliente,monkeypatch):
    monkeypatch.setitem(m.app.config,"PUBLIC_TUNNEL",True)
    monkeypatch.setitem(m.app.config,"SESSION_COOKIE_SECURE",True)
    r=cliente.get("/recuperar",base_url="https://puno.test")
    assert "Secure;" in r.headers["Set-Cookie"]
