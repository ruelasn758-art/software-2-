import app as m


def test_ruta_inexistente_muestra_pagina_propia(cliente):
    r = cliente.get("/ruta-que-no-existe")
    assert r.status_code == 404
    html = r.get_data(as_text=True)
    assert "Página no encontrada" in html
    assert "Volver al inicio" in html


def test_acceso_rechazado_muestra_pagina_propia(cliente, monkeypatch):
    monkeypatch.setitem(m.app.config, "PUBLIC_TUNNEL", True)
    r = cliente.post("/ingresar", headers={"Origin": "https://otro.test"})
    assert r.status_code == 403
    assert "Acceso no permitido" in r.get_data(as_text=True)


def test_api_y_archivos_conservan_su_respuesta(cliente):
    for ruta in ("/api/no-existe", "/static/no-existe.css"):
        r = cliente.get(ruta)
        assert r.status_code == 404
        assert "Volver al inicio" not in r.get_data(as_text=True)
