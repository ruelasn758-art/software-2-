"""Recuperación aislada; el correo se simula y no se envía a personas reales."""
import os, sys, tempfile, re, smtplib
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit, parse_qs
from itsdangerous import SignatureExpired
from werkzeug.security import check_password_hash
os.environ['PUNO_DB_BACKEND']='sqlite'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app as m
import recuperacion_correo as rc

def csrf(client):
    client.get('/recuperar')
    with client.session_transaction() as s:return s['csrf_recuperacion']

with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);m.DB_PATH=root/'test.db'
    m.UPLOAD_FOTOS=root/'fotos';m.UPLOAD_EVIDENCIAS=root/'evidencias';m.UPLOAD_DNI=root/'dni'
    m.init_db();m._db_ready=True;m.app.config['TESTING']=True
    with m.app.app_context():
        db=m.get_db()
        db.execute("INSERT INTO usuarios(codigo,rol,usuario,clave_hash,nombre,dni,telefono,estado,creado_en) VALUES('TEST','ciudadano','olvidado','original','Persona de prueba','12345678','999000000','Verificado','2026-01-01')")
        uid=db.execute("SELECT id FROM usuarios WHERE codigo='TEST'").fetchone()[0]
        aid=db.execute("SELECT id FROM usuarios WHERE rol='administrador' LIMIT 1").fetchone()[0];db.commit()
    c=m.app.test_client();admin=m.app.test_client()
    with admin.session_transaction() as s:s['usuario_id']=aid
    acsrf=csrf(admin);ccsrf=csrf(c)
    assert c.post('/recuperar',data={}).status_code==400
    data=dict(dni='12345678',telefono='999000000',nombre='Persona de prueba',correo='destino@example.com',csrf_recuperacion=ccsrf)
    assert c.post('/recuperar',data={**data,'dni':'87654321'}).status_code==302
    with m.app.app_context():assert m.get_db().execute('SELECT COUNT(*) FROM recuperaciones').fetchone()[0]==0
    assert c.post('/recuperar',data=data).status_code==302
    c.post('/recuperar',data=data)
    with m.app.app_context():
        db=m.get_db();rows=db.execute('SELECT * FROM recuperaciones').fetchall();assert len(rows)==1
        rid=rows[0]['id'];assert rows[0]['correo_recuperacion']=='destino@example.com'
    assert c.post('/admin/recuperacion/'+str(rid),data={}).status_code==302
    page=admin.get('/admin/cuentas')
    assert page.status_code==200 and b'destino@example.com' in page.data
    path='/admin/recuperacion/'+str(rid)
    sent=[]
    approval=dict(accion='aprobar',csrf_recuperacion=acsrf,identidad_confirmada='si')
    with patch.object(rc,'configuracion',return_value={}),patch.object(rc,'origen_publico',return_value='https://puno.example'),patch.object(rc,'enviar',side_effect=lambda *args:sent.append(args)):
        admin.post(path,data={**approval,'identidad_confirmada':''});assert not sent
        admin.post(path,data=approval);assert len(sent)==1
    token=parse_qs(urlsplit(sent[0][2]).query)['token'][0]
    assert sent[0][:2]==('destino@example.com','olvidado')
    assert c.get('/recuperar/enlace?token='+token).status_code==200
    reset=dict(token=token,csrf_recuperacion=ccsrf,clave='NuevaClave123',clave2='NuevaClave123')
    assert c.post('/recuperar/enlace',data={**reset,'token':token+'x'}).status_code==400
    with patch.object(rc.URLSafeTimedSerializer,'loads',side_effect=SignatureExpired('vencido')):
        assert c.get('/recuperar/enlace?token='+token).status_code==400
    reset['csrf_recuperacion']=csrf(c)
    assert c.post('/recuperar/enlace',data=reset).status_code==302
    assert c.get('/recuperar/enlace?token='+token).status_code==400
    with m.app.app_context():
        assert check_password_hash(m.get_db().execute('SELECT clave_hash FROM usuarios WHERE id=?',(uid,)).fetchone()[0],'NuevaClave123')
        assert m.get_db().execute('SELECT estado FROM recuperaciones WHERE id=?',(rid,)).fetchone()[0]=='Usada'
    data['csrf_recuperacion']=csrf(c)
    c.post('/recuperar',data=data)
    with m.app.app_context():rid2=m.get_db().execute('SELECT MAX(id) FROM recuperaciones').fetchone()[0]
    with patch.object(rc,'configuracion',return_value={}),patch.object(rc,'origen_publico',return_value='https://puno.example'),patch.object(rc,'enviar',side_effect=smtplib.SMTPException()):
        admin.post('/admin/recuperacion/'+str(rid2),data=approval)
    with m.app.app_context():
        row=m.get_db().execute('SELECT estado,codigo_clave FROM recuperaciones WHERE id=?',(rid2,)).fetchone()
        assert row[0]=='Pendiente' and row[1] is None
    for _ in range(12):response=c.post('/recuperar',data=data)
    assert response.status_code==429
print('OK: DNI sin usuario, duplicados, autorización/CSRF, correo simulado, vencimiento, uso único, clave actualizada, fallo SMTP y límite de intentos.')

