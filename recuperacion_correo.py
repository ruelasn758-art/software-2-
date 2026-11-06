"""Recuperación por DNI, revisión humana y enlace de correo de un solo uso."""
import hashlib
import json
import re
import secrets
import smtplib
import ssl
import threading
import time
from datetime import datetime, timedelta
from email.message import EmailMessage
from urllib.parse import urlsplit
from flask import abort, flash, redirect, render_template, request, session, url_for
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from werkzeug.security import generate_password_hash

_intentos = {}
_lock = threading.Lock()

def instalar(aplicacion, conexion, codigo, alertas, login, base):
    global app, get_db, siguiente_codigo, crear_alertas, BASE
    app, get_db, siguiente_codigo, crear_alertas, BASE = aplicacion, conexion, codigo, alertas, base
    app.jinja_env.globals['csrf_recuperacion'] = csrf
    app.add_url_rule('/recuperar/enlace', 'recuperar_enlace', enlace, methods=['GET', 'POST'])

def csrf():
    if 'csrf_recuperacion' not in session:
        session['csrf_recuperacion'] = secrets.token_urlsafe(32)
    return session['csrf_recuperacion']

def verificar_csrf():
    if not secrets.compare_digest(request.form.get('csrf_recuperacion', ''), csrf()):
        abort(400, 'Actualiza la página y vuelve a intentarlo.')

def limitar():
    # Esta aplicación sirve las solicitudes desde un proceso local con varios hilos.
    ip = request.remote_addr
    if app.config.get('PUBLIC_TUNNEL') and ip in ('127.0.0.1', '::1'):
        ip = request.headers.get('CF-Connecting-IP') or ip
    clave = (request.endpoint, ip)
    ahora = time.monotonic()
    with _lock:
        for k in list(_intentos):
            _intentos[k] = [t for t in _intentos[k] if ahora-t < 900]
            if not _intentos[k]: del _intentos[k]
        lista = _intentos.setdefault(clave, [])
        if len(lista) >= 10: abort(429, 'Demasiados intentos. Espera 15 minutos.')
        lista.append(ahora)

def solicitar():
    if request.method == 'POST':
        verificar_csrf(); limitar()
        dni = request.form.get('dni','').strip()
        telefono = request.form.get('telefono','').strip()
        correo = request.form.get('correo','').strip()
        nombre = request.form.get('nombre','').strip()
        if not (re.fullmatch(r'\d{8}',dni) and re.fullmatch(r'9\d{8}',telefono)
                and re.fullmatch(r'[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+',correo)
                and len(correo)<=254 and 3<=len(nombre)<=150):
            flash('Completa nombres, DNI de 8 dígitos, celular registrado y un correo válido.', 'error')
            return render_template('recuperar.html'),400
        db=get_db()
        fila=db.execute("SELECT * FROM usuarios WHERE dni=? AND telefono=? AND rol='ciudadano' AND estado='Verificado'",(dni,telefono)).fetchone()
        if fila:
            reciente=(datetime.now()-timedelta(hours=24)).isoformat(timespec='seconds')
            abierta=db.execute("SELECT id FROM recuperaciones WHERE usuario_id=? AND (estado='Pendiente' OR (estado='Aprobada' AND resuelto_en>?))",(fila['id'],reciente)).fetchone()
            if not abierta:
                db.execute("INSERT INTO recuperaciones(codigo,usuario_id,estado,creado_en,correo_recuperacion,nombre_solicitante) VALUES(?,?,'Pendiente',?,?,?)",
                           (siguiente_codigo('RC','recuperaciones'),fila['id'],datetime.now().isoformat(timespec='seconds'),correo,nombre))
                db.commit()
        # No revela si un DNI o teléfono pertenece a una cuenta.
        flash('Si los datos coinciden con una cuenta habilitada, el administrador revisará tu solicitud y podrá contactarte al celular registrado. Tras aprobarla recibirás un enlace en el correo indicado. Si ya hay una solicitud pendiente, se conserva la original.', 'ok')
        return redirect(url_for('recuperar'))
    return render_template('recuperar.html')

def configuracion():
    archivo=BASE/'private'/'correo'/'smtp.json'
    if not archivo.exists(): raise ValueError('Falta configurar Gmail. Ejecuta configurar_correo.bat en la computadora del sistema.')
    c=json.loads(archivo.read_text(encoding='utf-8-sig'))
    if not c.get('password'): raise ValueError('Falta la contraseña de aplicación de Gmail. Ejecuta configurar_correo.bat.')
    return c

def origen_publico():
    cpath=BASE/'private'/'correo'/'smtp.json'
    c=json.loads(cpath.read_text(encoding='utf-8-sig')) if cpath.exists() else {}
    origen=c.get('public_url','').rstrip('/')
    if not origen:
        archivo=BASE/'ENLACE_MOVIL.txt'
        texto=archivo.read_text(encoding='utf-8-sig') if archivo.exists() else ''
        match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com\b',texto)
        if match: origen=match.group(0)
    u=urlsplit(origen)
    if u.scheme!='https' or not u.hostname or u.username or u.query or u.fragment:
        raise ValueError('Inicia el acceso móvil para generar un enlace HTTPS antes de enviar la recuperación.')
    return origen

def enviar(destino, usuario, link):
    c=configuracion()
    mensaje=EmailMessage()
    mensaje['From']=c['username'];mensaje['To']=destino
    mensaje['Subject']='Recupera tu cuenta de Puno Reporta'
    mensaje.set_content(f'El administrador verificó tu solicitud.\n\nTu usuario es: {usuario}\n\nCrea una nueva contraseña con este enlace:\n{link}\n\nVence en 30 minutos y solo puede usarse una vez. Si no solicitaste la recuperación, ignora este mensaje.\nPuno Reporta')
    with smtplib.SMTP_SSL('smtp.gmail.com',465,context=ssl.create_default_context(),timeout=20) as smtp:
        smtp.login(c['username'],c['password'])
        smtp.send_message(mensaje)

def firmador():
    return URLSafeTimedSerializer(app.secret_key,salt='puno-recuperacion-correo-v1')

def resolver(fila):
    verificar_csrf()
    db=get_db();rid=fila['id'];accion=request.form.get('accion')
    if fila['estado'] not in ('Pendiente','Aprobada'):
        flash('Esta solicitud ya está cerrada.','error');return redirect(url_for('cuentas'))
    ahora=datetime.now().isoformat(timespec='seconds')
    if accion=='rechazar':
        db.execute("UPDATE recuperaciones SET estado='Rechazada',codigo_clave=NULL,resuelto_en=? WHERE id=?",(ahora,rid));db.commit()
        flash('Solicitud rechazada.','ok')
    elif accion=='aprobar':
        if request.form.get('identidad_confirmada')!='si':
            flash('Confirma la identidad y el correo con el titular antes de enviar el enlace.','error')
            return redirect(url_for('cuentas'))
        persona=db.execute('SELECT estado FROM usuarios WHERE id=?',(fila['usuario_id'],)).fetchone()
        if not persona or persona['estado']!='Verificado':
            flash('La cuenta no está habilitada para recuperación.','error');return redirect(url_for('cuentas'))
        try:
            configuracion();origen=origen_publico()
        except (ValueError,OSError) as e:
            flash(str(e),'error');return redirect(url_for('cuentas'))
        nonce=secrets.token_urlsafe(32)
        token=firmador().dumps({'rid':rid,'nonce':nonce})
        huella=hashlib.sha256(nonce.encode()).hexdigest()
        db.execute("UPDATE recuperaciones SET estado='Aprobada',codigo_clave=?,resuelto_en=? WHERE id=?",(huella,ahora,rid));db.commit()
        try:
            enviar(fila['correo_recuperacion'],fila['usuario'],origen+url_for('recuperar_enlace',token=token))
        except (OSError,smtplib.SMTPException,ValueError):
            db.execute("UPDATE recuperaciones SET estado='Pendiente',codigo_clave=NULL,resuelto_en=NULL WHERE id=?",(rid,));db.commit()
            flash('No se pudo enviar el correo. La solicitud sigue pendiente; revisa la configuración de Gmail e inténtalo otra vez.','error')
        else:
            flash('Gmail aceptó el correo de recuperación. El enlace vence en 30 minutos; pide al ciudadano revisar también Spam.','ok')
    return redirect(url_for('cuentas'))

def enlace():
    token=request.form.get('token') if request.method=='POST' else request.args.get('token','')
    if request.method=='POST': verificar_csrf();limitar()
    try:
        payload=firmador().loads(token,max_age=1800)
        huella=hashlib.sha256(payload['nonce'].encode()).hexdigest()
        rid=int(payload['rid'])
    except (BadSignature,SignatureExpired,KeyError,TypeError,ValueError):
        return render_template('recuperar_enlace.html',valido=False),400
    db=get_db()
    fila=db.execute("SELECT r.*,u.usuario,u.estado AS estado_usuario FROM recuperaciones r JOIN usuarios u ON u.id=r.usuario_id WHERE r.id=?",(rid,)).fetchone()
    valido=fila and fila['estado']=='Aprobada' and fila['estado_usuario']=='Verificado' and secrets.compare_digest(fila['codigo_clave'] or '',huella)
    if not valido: return render_template('recuperar_enlace.html',valido=False),400
    if request.method=='POST':
        clave=request.form.get('clave','');repetir=request.form.get('clave2','')
        if len(clave)<8 or len(clave)>256 or clave!=repetir:
            flash('Las contraseñas deben coincidir y tener entre 8 y 256 caracteres.','error')
        else:
            ahora=datetime.now().isoformat(timespec='seconds')
            # Reclamo atómico: dos envíos simultáneos no pueden usar el mismo enlace.
            if getattr(db,'postgres',False):
                usado=db.execute("UPDATE public.notificacion SET estado_recuperacion='Usada',codigo_clave=NULL,resuelto_en=? WHERE id_notificacion=? AND estado_recuperacion='Aprobada' AND codigo_clave=? RETURNING id_notificacion",(ahora,rid,huella)).fetchone()
            else:
                usado=db.execute("UPDATE recuperaciones SET estado='Usada',codigo_clave=NULL,resuelto_en=? WHERE id=? AND estado='Aprobada' AND codigo_clave=? RETURNING id",(ahora,rid,huella)).fetchone()
            if not usado:
                db.rollback();return render_template('recuperar_enlace.html',valido=False),400
            db.execute('UPDATE usuarios SET clave_hash=? WHERE id=?',(generate_password_hash(clave),fila['usuario_id']))
            db.execute("UPDATE recuperaciones SET estado='Rechazada',codigo_clave=NULL,resuelto_en=? WHERE usuario_id=? AND id<>? AND estado IN ('Pendiente','Aprobada')",(ahora,fila['usuario_id'],rid))
            db.commit();session.clear()
            flash('Contraseña actualizada. Ingresa con el usuario que recibiste en el correo.','ok')
            return redirect(url_for('ingresar'))
    respuesta=app.make_response(render_template('recuperar_enlace.html',valido=True,token=token,usuario_recuperado=fila['usuario']))
    respuesta.headers['Referrer-Policy']='no-referrer';respuesta.headers['Cache-Control']='no-store'
    return respuesta
