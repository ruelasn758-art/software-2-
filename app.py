"""
PUNO REPORTA — sistema local de incidencias ciudadanas.
Roles: administrador, ciudadano y operador de área.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import database_backend
from datetime import datetime
from functools import wraps
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

from flask import (
    Flask,
    abort,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "puno_reporta.db"
UPLOAD_FOTOS = BASE_DIR / "static" / "uploads" / "fotos"
UPLOAD_EVIDENCIAS = BASE_DIR / "static" / "uploads" / "evidencias"
UPLOAD_DNI = BASE_DIR / "private" / "dni"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

PUNO_LAT = -15.8402
PUNO_LNG = -70.0219

def clave_sesion_local():
    archivo = BASE_DIR / "private" / "security" / "session-key.txt"
    archivo.parent.mkdir(parents=True, exist_ok=True)
    try:
        with archivo.open("x", encoding="utf-8") as salida:
            salida.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    return archivo.read_text(encoding="utf-8").strip()


SECRET_KEY = clave_sesion_local()

APARTADOS = {
    "vias": {
        "titulo": "Vías",
        "subtitulo": "Baches, pistas y veredas",
        "categoria": "Bache",
        "color": "#6B7280",
        "clase": "vias",
    },
    "basura": {
        "titulo": "Basura",
        "subtitulo": "Residuos y limpieza",
        "categoria": "Basura",
        "color": "#22A45A",
        "clase": "basura",
    },
    "alumbrado": {
        "titulo": "Alumbrado",
        "subtitulo": "Luminarias y postes",
        "categoria": "Luminaria",
        "color": "#E8A317",
        "clase": "alumbrado",
    },
    "agua": {
        "titulo": "Agua",
        "subtitulo": "Fugas y saneamiento",
        "categoria": "Fuga",
        "color": "#1B4F8A",
        "clase": "agua",
    },
}
DNI_RE = re.compile(r"^\d{8}$")
CEL_RE = re.compile(r"^9\d{8}$")

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.secret_key = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PUBLIC_TUNNEL"] = False
_db_ready = False


@app.before_request
def asegurar_db():
    global _db_ready
    if not _db_ready:
        init_db()
        _db_ready = True


@app.before_request
def proteger_acceso_publico():
    filename = (request.view_args or {}).get("filename", "")
    fichero = (Path(app.static_folder) / filename).resolve() if request.endpoint == "static" else None
    uploads = Path(app.static_folder, "uploads").resolve()
    foto = fichero is not None and fichero.is_relative_to(uploads)
    if request.endpoint == "static" and not foto:
        return None
    user = usuario_actual()
    if user and user["estado"] == "Suspendido":
        session.clear()
        user = None
    if app.config["PUBLIC_TUNNEL"] and request.method == "POST":
        origen = request.headers.get("Origin") or request.headers.get("Referer")
        if not origen or urlsplit(origen).netloc != request.host:
            abort(403)
    privadas = {"api_reportes", "api_buscar_lugar", "api_direccion", "detalle", "consultar"}
    if not user and (request.endpoint in privadas or foto):
        if (request.endpoint or "").startswith("api_") or foto:
            abort(401)
        return redirect(url_for("ingresar"))
    if foto:
        partes = fichero.relative_to(uploads).parts
        if len(partes) != 2: abort(404)
        carpeta, nombre = partes
        db = get_db()
        if carpeta.lower() == "evidencias":
            consulta = "SELECT r.* FROM reportes r JOIN evidencias e ON r.id=e.reporte_id WHERE e.fotografia=?"
            params = (nombre,)
        elif carpeta.lower() == "fotos":
            refs = ("SELECT id_reporte FROM public.archivo_reporte WHERE ruta_archivo=? AND descripcion='REFERENCIA'"
                    if getattr(db,"postgres",False) else "SELECT reporte_id FROM fotos_referencia WHERE fotografia=?")
            consulta = "SELECT r.* FROM reportes r WHERE r.foto=? OR r.id IN ("+refs+")"
            params = (nombre,nombre)
        else: abort(404)
        r = db.execute(consulta, params).fetchone()
        if not r or not (r["usuario_id"] == user["id"] or puede_atender(user,r)): abort(404)


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        from flask import has_request_context
        g.db = database_backend.conectar(
            session.get('usuario_id') if has_request_context() else None,
            request.remote_addr if has_request_context() else None,
        )
        if g.db is None:
            g.db = sqlite3.connect(DB_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def ensure_column(db: sqlite3.Connection, tabla: str, columna: str, definicion: str) -> None:
    cols = [r[1] for r in db.execute(f"PRAGMA table_info({tabla})")]
    if columna not in cols:
        db.execute(f"ALTER TABLE {tabla} ADD COLUMN {columna} {definicion}")


def init_db() -> None:
    if database_backend.configuracion():
        with app.app_context():
            db = get_db()
            db.execute('SELECT id FROM usuarios LIMIT 1')
        for carpeta in (UPLOAD_FOTOS, UPLOAD_EVIDENCIAS, UPLOAD_DNI):
            carpeta.mkdir(parents=True, exist_ok=True)
        return
    for carpeta in (UPLOAD_FOTOS, UPLOAD_EVIDENCIAS, UPLOAD_DNI):
        carpeta.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS fotos_referencia (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporte_id INTEGER NOT NULL REFERENCES reportes(id),
            fotografia TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            nombre TEXT NOT NULL,
            dependencia TEXT NOT NULL CHECK (dependencia IN ('municipal', 'externa'))
        );

        CREATE TABLE IF NOT EXISTS categorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            nombre TEXT NOT NULL CHECK (nombre IN ('Bache', 'Basura', 'Luminaria', 'Fuga')),
            tipo TEXT NOT NULL CHECK (tipo IN ('urbana')),
            area_id INTEGER NOT NULL REFERENCES areas(id)
        );

        CREATE TABLE IF NOT EXISTS reportes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            foto TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            descripcion TEXT NOT NULL,
            estado TEXT NOT NULL CHECK (estado IN ('Reportado', 'En proceso', 'Solucionado')),
            ciudadano_nombre TEXT NOT NULL,
            ciudadano_contacto TEXT NOT NULL,
            categoria_id INTEGER NOT NULL REFERENCES categorias(id),
            area_id INTEGER NOT NULL REFERENCES areas(id),
            creado_en TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS evidencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            fotografia TEXT NOT NULL,
            fecha TEXT NOT NULL,
            reporte_id INTEGER NOT NULL REFERENCES reportes(id)
        );

        CREATE TABLE IF NOT EXISTS notificaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            mensaje TEXT NOT NULL,
            estado TEXT NOT NULL CHECK (estado IN ('Pendiente', 'Enviada')),
            reporte_id INTEGER NOT NULL REFERENCES reportes(id),
            creado_en TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            rol TEXT NOT NULL CHECK (rol IN ('administrador', 'ciudadano', 'operador')),
            usuario TEXT UNIQUE NOT NULL,
            clave_hash TEXT NOT NULL,
            nombre TEXT NOT NULL,
            dni TEXT UNIQUE,
            dni_foto TEXT,
            telefono TEXT,
            direccion TEXT,
            referencia TEXT,
            estado TEXT NOT NULL CHECK (estado IN ('Pendiente', 'Verificado', 'Rechazado', 'Suspendido')),
            area_id INTEGER REFERENCES areas(id),
            motivo TEXT,
            creado_en TEXT NOT NULL,
            verificado_en TEXT
        );

        CREATE TABLE IF NOT EXISTS recuperaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
            estado TEXT NOT NULL CHECK (estado IN ('Pendiente', 'Aprobada', 'Usada', 'Rechazada')),
            codigo_clave TEXT,
            creado_en TEXT NOT NULL,
            resuelto_en TEXT
        );

        CREATE TABLE IF NOT EXISTS alertas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
            reporte_id INTEGER REFERENCES reportes(id),
            mensaje TEXT NOT NULL,
            leida INTEGER NOT NULL DEFAULT 0,
            creado_en TEXT NOT NULL
        );
        """
    )
    ensure_column(db, "recuperaciones", "correo_recuperacion", "TEXT")
    ensure_column(db, "recuperaciones", "nombre_solicitante", "TEXT")
    ensure_column(db, "reportes", "usuario_id", "INTEGER REFERENCES usuarios(id)")
    ensure_column(db, "reportes", "verificado_sitio", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(db, "reportes", "operador_id", "INTEGER REFERENCES usuarios(id)")
    ensure_column(db, "reportes", "referencia", "TEXT")
    ensure_column(db, "reportes", "direccion_mapa", "TEXT")

    if db.execute("SELECT COUNT(*) FROM areas").fetchone()[0] == 0:
        db.executemany(
            "INSERT INTO areas (codigo, nombre, dependencia) VALUES (?, ?, ?)",
            [
                ("AR-OP", "Obras Públicas", "municipal"),
                ("AR-LP", "Limpieza Pública", "municipal"),
                ("AR-AP", "Electro Puno · Área de Alumbrado Público", "externa"),
                ("AR-SD", "EMSAPUNO · Área de Operaciones de Agua y Alcantarillado", "externa"),
            ],
        )
        db.executemany(
            """
            INSERT INTO categorias (codigo, nombre, tipo, area_id)
            VALUES (?, ?, 'urbana', (SELECT id FROM areas WHERE codigo = ?))
            """,
            [
                ("CAT-BCH", "Bache", "AR-OP"),
                ("CAT-BSR", "Basura", "AR-LP"),
                ("CAT-LUM", "Luminaria", "AR-AP"),
                ("CAT-FUG", "Fuga", "AR-SD"),
            ],
        )

    db.execute("UPDATE areas SET nombre='EMSAPUNO · Área de Operaciones de Agua y Alcantarillado' WHERE codigo='AR-SD' AND nombre='SEDAPAR'")
    db.execute("UPDATE areas SET nombre='Electro Puno · Área de Alumbrado Público',dependencia='externa' WHERE codigo='AR-AP' AND nombre='Alumbrado Público'")
    if db.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0] == 0:
        ahora = datetime.now().isoformat(timespec="seconds")
        claves = {nombre: secrets.token_urlsafe(24) for nombre in ("admin","operador")}
        alumbrado = db.execute("SELECT id FROM areas WHERE codigo = 'AR-AP'").fetchone()[0]
        db.execute(
            """
            INSERT INTO usuarios (
                codigo, rol, usuario, clave_hash, nombre, dni, telefono, direccion,
                estado, creado_en, verificado_en
            ) VALUES (?, 'administrador', ?, ?, ?, ?, ?, ?, 'Verificado', ?, ?)
            """,
            (
                "US-2026-0001",
                "admin",
                generate_password_hash(claves["admin"]),
                "Administrador municipal",
                "10000001",
                "951000001",
                "Plaza de Armas, Puno",
                ahora,
                ahora,
            ),
        )
        db.execute(
            """
            INSERT INTO usuarios (
                codigo, rol, usuario, clave_hash, nombre, dni, telefono, direccion,
                estado, area_id, creado_en, verificado_en
            ) VALUES (?, 'operador', ?, ?, ?, ?, ?, ?, 'Verificado', ?, ?, ?)
            """,
            (
                "US-2026-0002",
                "operador",
                generate_password_hash(claves["operador"]),
                "Técnico de Alumbrado",
                "10000002",
                "951000002",
                "Jr. Lima, Puno",
                alumbrado,
                ahora,
                ahora,
            ),
        )
        archivo = DB_PATH.parent / "private" / "security" / "cuentas-locales.txt"
        archivo.parent.mkdir(parents=True, exist_ok=True)
        with archivo.open("a", encoding="utf-8") as salida:
            for nombre, clave in claves.items():
                salida.write(f"Usuario: {nombre}\nClave: {clave}\n\n")
    db.commit()
    db.close()


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def guardar_archivo(file_storage, carpeta: Path) -> str:
    original = secure_filename(file_storage.filename or "")
    ext = original.rsplit(".", 1)[1].lower() if "." in original else "jpg"
    nombre = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}.{ext}"
    file_storage.save(carpeta / nombre)
    return nombre


def ubicacion_valida(lat: float, lng: float) -> bool:
    return (
        -90 <= lat <= 90
        and -180 <= lng <= 180
    )


def siguiente_codigo(prefijo: str, tabla: str) -> str:
    db = get_db()
    anio = datetime.now().year
    if getattr(db, 'postgres', False):
        db.execute('SELECT pg_advisory_xact_lock(hashtext(?))', (f'{tabla}:{anio}',))
    fila = db.execute(
        f"SELECT codigo FROM {tabla} WHERE codigo LIKE ? ORDER BY id DESC LIMIT 1",
        (f"{prefijo}-{anio}-%",),
    ).fetchone()
    numero = 1
    if fila:
        numero = int(fila["codigo"].split("-")[-1]) + 1
    return f"{prefijo}-{anio}-{numero:04d}"


def usuario_actual():
    uid = session.get("usuario_id")
    if not uid:
        return None
    return get_db().execute(
        """
        SELECT u.*, a.nombre AS area_nombre, a.codigo AS area_codigo
        FROM usuarios u
        LEFT JOIN areas a ON a.id = u.area_id
        WHERE u.id = ?
        """,
        (uid,),
    ).fetchone()


def login_required(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = usuario_actual()
            if not user or user["estado"] == "Suspendido":
                session.clear()
                flash("Inicia sesión para continuar.", "error")
                return redirect(url_for("ingresar", siguiente=request.path))
            if roles and user["rol"] not in roles:
                flash("No tienes permiso para esa sección.", "error")
                return redirect(url_for("inicio_segun_rol"))
            return fn(*args, **kwargs)

        return wrapped

    return decorator


def consultar_catalogo_categoria(categoria_id: int) -> sqlite3.Row | None:
    return get_db().execute(
        """
        SELECT c.id AS categoria_id, c.codigo AS categoria_codigo, c.nombre AS categoria_nombre,
               c.tipo, a.id AS area_id, a.codigo AS area_codigo, a.nombre AS area_nombre,
               a.dependencia
        FROM categorias c
        JOIN areas a ON a.id = c.area_id
        WHERE c.id = ?
        """,
        (categoria_id,),
    ).fetchone()


def registrar_reporte(datos: dict) -> sqlite3.Row:
    db = get_db()
    codigo = siguiente_codigo("PR", "reportes")
    db.execute(
        """
        INSERT INTO reportes (
            codigo, foto, lat, lng, descripcion, estado,
            ciudadano_nombre, ciudadano_contacto, categoria_id, area_id,
            creado_en, usuario_id, referencia, direccion_mapa
        ) VALUES (?, ?, ?, ?, ?, 'Reportado', ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            codigo,
            datos["foto"],
            datos["lat"],
            datos["lng"],
            datos["descripcion"],
            datos["ciudadano_nombre"],
            datos["ciudadano_contacto"],
            datos["categoria_id"],
            datos["area_id"],
            datetime.now().isoformat(timespec="seconds"),
            datos["usuario_id"],
            datos.get("referencia") or "",
            datos.get("direccion_mapa") or "",
        ),
    )
    db.commit()
    return db.execute("SELECT * FROM reportes WHERE codigo = ?", (codigo,)).fetchone()


def clasificar_reporte(reporte_id: int, categoria_id: int) -> None:
    db = get_db()
    db.execute("UPDATE reportes SET categoria_id = ? WHERE id = ?", (categoria_id, reporte_id))
    db.commit()


def asignar_responsable(reporte_id: int, area_id: int) -> None:
    db = get_db()
    db.execute("UPDATE reportes SET area_id = ? WHERE id = ?", (area_id, reporte_id))
    db.commit()


def actualizar_estado(reporte_id: int, nuevo_estado: str) -> None:
    if nuevo_estado not in {"Reportado", "En proceso", "Solucionado"}:
        raise ValueError("Estado no permitido")
    db = get_db()
    db.execute("UPDATE reportes SET estado = ? WHERE id = ?", (nuevo_estado, reporte_id))
    db.commit()


def registrar_evidencia(reporte_id: int, fotografia: str, fecha: str) -> sqlite3.Row:
    db = get_db()
    codigo = siguiente_codigo("EV", "evidencias")
    db.execute(
        "INSERT INTO evidencias (codigo, fotografia, fecha, reporte_id) VALUES (?, ?, ?, ?)",
        (codigo, fotografia, fecha, reporte_id),
    )
    db.commit()
    return db.execute("SELECT * FROM evidencias WHERE codigo = ?", (codigo,)).fetchone()


def generar_notificacion(reporte_id: int, mensaje: str) -> sqlite3.Row:
    db = get_db()
    codigo = siguiente_codigo("NT", "notificaciones")
    db.execute(
        """
        INSERT INTO notificaciones (codigo, mensaje, estado, reporte_id, creado_en)
        VALUES (?, ?, 'Enviada', ?, ?)
        """,
        (codigo, mensaje, reporte_id, datetime.now().isoformat(timespec="seconds")),
    )
    db.commit()
    return db.execute("SELECT * FROM notificaciones WHERE codigo = ?", (codigo,)).fetchone()


def crear_alertas(mensaje: str, *, reporte_id: int, area_id: int) -> None:
    db = get_db()
    destinos = db.execute(
        "SELECT id FROM usuarios WHERE estado='Verificado' AND rol='operador' AND area_id=?",
        (area_id,),
    ).fetchall()
    ahora = datetime.now().isoformat(timespec="seconds")
    for fila in destinos:
        db.execute(
            """
            INSERT INTO alertas (usuario_id, reporte_id, mensaje, leida, creado_en)
            VALUES (?, ?, ?, 0, ?)
            """,
            (fila["id"], reporte_id, mensaje, ahora),
        )
    db.commit()


def guardar_referencias(reporte_id, fotos):
    db = get_db()
    guardados = []
    try:
        for foto in fotos:
            nombre = guardar_archivo(foto, UPLOAD_FOTOS)
            guardados.append(nombre)
            if getattr(db, 'postgres', False):
                db.execute("INSERT INTO public.archivo_reporte (id_reporte, tipo_archivo, ruta_archivo, nombre_original, descripcion) VALUES (?, 'INCIDENCIA', ?, ?, 'REFERENCIA')",
                           (reporte_id, nombre, secure_filename(foto.filename)))
            else:
                db.execute("INSERT INTO fotos_referencia (reporte_id, fotografia) VALUES (?, ?)", (reporte_id, nombre))
        db.commit()
    except Exception:
        db.rollback()
        for nombre in guardados:
            (UPLOAD_FOTOS / nombre).unlink(missing_ok=True)
        raise


def listar_referencias(reporte_id):
    db = get_db()
    if getattr(db, 'postgres', False):
        return db.execute("SELECT ruta_archivo AS fotografia FROM public.archivo_reporte WHERE id_reporte = ? AND descripcion = 'REFERENCIA' AND tipo_archivo = 'INCIDENCIA' ORDER BY id_archivo", (reporte_id,)).fetchall()
    return db.execute("SELECT fotografia FROM fotos_referencia WHERE reporte_id = ? ORDER BY id", (reporte_id,)).fetchall()


def reporte_completo(codigo: str) -> dict | None:
    db = get_db()
    fila = db.execute(
        """
        SELECT r.*, c.nombre AS categoria_nombre, c.codigo AS categoria_codigo, c.tipo,
               a.nombre AS area_nombre, a.codigo AS area_codigo, a.dependencia
        FROM reportes r
        JOIN categorias c ON c.id = r.categoria_id
        JOIN areas a ON a.id = r.area_id
        WHERE r.codigo = ?
        """,
        (codigo,),
    ).fetchone()
    if not fila:
        return None
    evidencias = db.execute(
        "SELECT * FROM evidencias WHERE reporte_id = ? ORDER BY id DESC",
        (fila["id"],),
    ).fetchall()
    notificaciones = db.execute(
        "SELECT * FROM notificaciones WHERE reporte_id = ? ORDER BY id DESC",
        (fila["id"],),
    ).fetchall()
    return {"reporte": fila, "evidencias": evidencias, "notificaciones": notificaciones, "fotos_referencia": listar_referencias(fila["id"])}


def listar_reportes(
    estado: str | None = None,
    area_id: int | None = None,
    usuario_id: int | None = None,
    categoria: str | None = None,
):
    sql = """
        SELECT r.*, c.nombre AS categoria_nombre, a.nombre AS area_nombre, a.dependencia
        FROM reportes r
        JOIN categorias c ON c.id = r.categoria_id
        JOIN areas a ON a.id = r.area_id
        WHERE 1=1
    """
    params: list = []
    if estado:
        sql += " AND r.estado = ?"
        params.append(estado)
    if area_id:
        sql += " AND r.area_id = ?"
        params.append(area_id)
    if usuario_id:
        sql += " AND r.usuario_id = ?"
        params.append(usuario_id)
    if categoria:
        sql += " AND c.nombre = ?"
        params.append(categoria)
    sql += " ORDER BY r.id DESC"
    return get_db().execute(sql, params).fetchall()


def puede_atender(user, reporte) -> bool:
    if user["rol"] == "operador" and user["area_id"] == reporte["area_id"]:
        return True
    return False


@app.context_processor
def inject_globals():
    user = usuario_actual()
    n_alertas = 0
    n_pendientes = 0
    if user and user["rol"] == "operador":
        n_alertas = get_db().execute(
            "SELECT COUNT(*) FROM alertas a JOIN reportes r ON r.id=a.reporte_id WHERE a.usuario_id=? AND r.area_id=? AND a.leida=0",
            (user["id"],user["area_id"]),
        ).fetchone()[0]
    if user and user["rol"] == "administrador":
        n_pendientes = get_db().execute("SELECT COUNT(*) FROM recuperaciones WHERE estado='Pendiente'").fetchone()[0]
    return {
        "puno_lat": PUNO_LAT,
        "puno_lng": PUNO_LNG,
        "usuario": user,
        "n_alertas": n_alertas,
        "n_pendientes": n_pendientes,
        "es_admin": bool(user and user["rol"] == "administrador"),
        "es_operador": bool(user and user["rol"] == "operador"),
        "es_ciudadano": bool(user and user["rol"] == "ciudadano"),
        "apartados": APARTADOS,
        "landing": bool(user is None and request.endpoint == "index"),
    }


@app.route("/inicio")
@app.route("/inicio-rol")
def inicio_segun_rol():
    user = usuario_actual()
    if not user:
        return redirect(url_for("index"))
    if user["rol"] == "administrador":
        return redirect(url_for("cuentas"))
    if user["rol"] == "operador":
        return redirect(url_for("alertas"))
    return redirect(url_for("index"))


@app.route("/")
def index():
    user = usuario_actual()
    if user and user["rol"] == "ciudadano":
        mios = listar_reportes(usuario_id=user["id"])
        conteos = {
            slug: len(listar_reportes(categoria=meta["categoria"]))
            for slug, meta in APARTADOS.items()
        }
        return render_template("ciudadano.html", mios=mios, conteos=conteos)
    if user and user["rol"] == "administrador":
        return redirect(url_for("cuentas"))
    if not user:
        return render_template("landing.html", landing=True)
    reportes = listar_reportes(area_id=user["area_id"]) if user["rol"]=="operador" and user["area_id"] else []
    categorias = get_db().execute("SELECT * FROM categorias ORDER BY nombre").fetchall()
    totales = {
        "total": len(reportes),
        "reportado": sum(1 for r in reportes if r["estado"] == "Reportado"),
        "proceso": sum(1 for r in reportes if r["estado"] == "En proceso"),
        "solucionado": sum(1 for r in reportes if r["estado"] == "Solucionado"),
    }
    return render_template("index.html", reportes=reportes, categorias=categorias, totales=totales)


@app.route("/apartado/<slug>")
@login_required("ciudadano")
def apartado(slug: str):
    meta = APARTADOS.get(slug)
    if not meta:
        abort(404)
    reportes = listar_reportes(categoria=meta["categoria"])
    return render_template("apartado.html", meta=meta, slug=slug, reportes=reportes)


@app.route("/mapa")
@login_required("ciudadano")
def mapa_ciudadano():
    return render_template("mapa_ciudadano.html", reportes=listar_reportes())


@app.route("/api/reportes")
def api_reportes():
    user = usuario_actual()
    area_id = user["area_id"] if user and user["rol"] == "operador" else None
    if user and user["rol"] == "operador" and (not area_id or user["estado"] != "Verificado"):
        return jsonify([])
    categoria = request.args.get("categoria") or None
    mios = request.args.get("mios") == "1"
    usuario_id = user["id"] if mios and user and user["rol"] == "ciudadano" else None
    filas = listar_reportes(area_id=area_id, categoria=categoria, usuario_id=usuario_id)
    return jsonify(
        [
            {
                "codigo": r["codigo"],
                "lat": r["lat"],
                "lng": r["lng"],
                "estado": r["estado"],
                "categoria": r["categoria_nombre"],
                "area": r["area_nombre"],
                "descripcion": r["descripcion"] if r["usuario_id"] == user["id"] or puede_atender(user,r) else "",
                "referencia": (dict(r).get("referencia") or "") if r["usuario_id"] == user["id"] or puede_atender(user,r) else "",
                "direccion": (dict(r).get("direccion_mapa") or "") if r["usuario_id"] == user["id"] or puede_atender(user,r) else "",
                "color": next(
                    (m["color"] for m in APARTADOS.values() if m["categoria"] == r["categoria_nombre"]),
                    "#1E7AE6",
                ),
            }
            for r in filas
        ]
    )


def nominatim(path: str, params: dict):
    query = urlencode(params)
    req = Request(
        f"https://nominatim.openstreetmap.org{path}?{query}",
        headers={"User-Agent": "PunoReporta-EST323/1.0 (localhost)"},
    )
    with urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


@app.route("/api/buscar-lugar")
def api_buscar_lugar():
    q = (request.args.get("q") or "").strip()
    if len(q) < 3:
        return jsonify([])
    try:
        datos = nominatim(
            "/search",
            {
                "format": "json",
                "limit": 6,
                "addressdetails": 1,
                "q": q,
            },
        )
    except (URLError, TimeoutError, ValueError):
        return jsonify([])
    return jsonify(
        [
            {
                "nombre": item.get("display_name", ""),
                "lat": float(item["lat"]),
                "lng": float(item["lon"]),
            }
            for item in datos
        ]
    )


@app.route("/api/direccion")
def api_direccion():
    try:
        lat = float(request.args.get("lat"))
        lng = float(request.args.get("lng"))
        datos = nominatim(
            "/reverse",
            {"format": "jsonv2", "lat": lat, "lon": lng, "zoom": 18, "addressdetails": 1},
        )
        return jsonify({"direccion": datos.get("display_name") or ""})
    except (TypeError, ValueError, URLError, TimeoutError):
        return jsonify({"direccion": ""})


@app.route("/ingresar", methods=["GET", "POST"])
def ingresar():
    if usuario_actual():
        return redirect(url_for("inicio_segun_rol"))
    if request.method == "POST":
        usuario = (request.form.get("usuario") or "").strip().lower()
        clave = request.form.get("clave") or ""
        fila = get_db().execute(
            "SELECT * FROM usuarios WHERE usuario = ?",
            (usuario,),
        ).fetchone()
        if not fila or not check_password_hash(fila["clave_hash"], clave):
            flash("Usuario o contraseña incorrectos.", "error")
            return render_template("ingresar.html")
        if fila["estado"] == "Suspendido":
            flash("Tu cuenta está suspendida. Habla con la municipalidad.", "error")
            return render_template("ingresar.html")
        session.clear()
        session["usuario_id"] = fila["id"]
        session["rol"] = fila["rol"]
        if fila["estado"] == "Pendiente":
            flash("Tu cuenta está en revisión. Un administrador validará tu DNI.", "ok")
        elif fila["estado"] == "Rechazado":
            flash("Tu verificación fue rechazada. Revisa el motivo en tu perfil.", "error")
        else:
            flash(f"Bienvenido, {fila['nombre']}.", "ok")
        destino = request.values.get("siguiente") or url_for("inicio_segun_rol")
        if destino.startswith("/") and not destino.startswith("//") and "\\" not in destino:
            return redirect(destino)
        return redirect(url_for("inicio_segun_rol"))
    return render_template("ingresar.html")


@app.route("/salir")
def salir():
    session.clear()
    flash("Sesión cerrada.", "ok")
    return redirect(url_for("index"))


@app.route("/registro", methods=["GET", "POST"])
def registro():
    if usuario_actual():
        return redirect(url_for("inicio_segun_rol"))
    if request.method == "POST":
        nombre = (request.form.get("nombre") or "").strip()
        usuario = (request.form.get("usuario") or "").strip().lower()
        dni = (request.form.get("dni") or "").strip()
        telefono = (request.form.get("telefono") or "").strip()
        direccion = (request.form.get("direccion") or "").strip()
        referencia = (request.form.get("referencia") or "").strip()
        clave = request.form.get("clave") or ""
        clave2 = request.form.get("clave2") or ""
        dni_foto = request.files.get("dni_foto")
        errores = []
        if len(nombre) < 5:
            errores.append("Escribe tu nombre completo.")
        if len(usuario) < 4 or " " in usuario:
            errores.append("El usuario debe tener al menos 4 caracteres, sin espacios.")
        if not DNI_RE.match(dni):
            errores.append("El DNI debe tener 8 dígitos.")
        if not CEL_RE.match(telefono):
            errores.append("El celular debe tener 9 dígitos y empezar con 9.")
        if len(direccion) < 8:
            errores.append("Indica tu dirección de vivienda en Puno.")
        if len(clave) < 6:
            errores.append("La contraseña debe tener al menos 6 caracteres.")
        if clave != clave2:
            errores.append("Las contraseñas no coinciden.")
        if not dni_foto or not dni_foto.filename:
            errores.append("Sube una foto nítida de tu DNI.")
        elif not allowed_file(dni_foto.filename):
            errores.append("La foto del DNI debe ser JPG, PNG o WEBP.")
        db = get_db()
        if db.execute("SELECT id FROM usuarios WHERE usuario = ?", (usuario,)).fetchone():
            errores.append("Ese nombre de usuario ya existe.")
        if db.execute("SELECT id FROM usuarios WHERE dni = ?", (dni,)).fetchone():
            errores.append("Ese DNI ya está registrado.")
        if errores:
            for e in errores:
                flash(e, "error")
            return render_template("registro.html"), 400
        archivo = guardar_archivo(dni_foto, UPLOAD_DNI)
        codigo = siguiente_codigo("US", "usuarios")
        db.execute(
            """
            INSERT INTO usuarios (
                codigo, rol, usuario, clave_hash, nombre, dni, dni_foto, telefono,
                direccion, referencia, estado, creado_en
            ) VALUES (?, 'ciudadano', ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?)
            """,
            (
                codigo,
                usuario,
                generate_password_hash(clave),
                nombre,
                dni,
                archivo,
                telefono,
                direccion,
                referencia,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )
        db.commit()
        nuevo = db.execute("SELECT id FROM usuarios WHERE usuario = ?", (usuario,)).fetchone()
        session["usuario_id"] = nuevo["id"]
        session["rol"] = "ciudadano"
        flash("Cuenta creada. Un administrador revisará tu DNI antes de que puedas reportar.", "ok")
        return redirect(url_for("perfil"))
    return render_template("registro.html")


@app.route("/recuperar", methods=["GET", "POST"])
def recuperar():
    return recuperacion_correo.solicitar()


@app.route("/recuperar/clave", methods=["GET", "POST"])
def recuperar_clave():
    if request.method == "POST":
        usuario = (request.form.get("usuario") or "").strip().lower()
        codigo = (request.form.get("codigo_clave") or "").strip()
        clave = request.form.get("clave") or ""
        clave2 = request.form.get("clave2") or ""
        if len(clave) < 6 or clave != clave2:
            flash("La nueva contraseña debe coincidir y tener al menos 6 caracteres.", "error")
            return render_template("recuperar_clave.html"), 400
        fila = get_db().execute(
            """
            SELECT r.*, u.usuario FROM recuperaciones r
            JOIN usuarios u ON u.id = r.usuario_id
            WHERE u.usuario = ? AND r.estado = 'Aprobada'
            ORDER BY r.id DESC LIMIT 1
            """,
            (usuario,),
        ).fetchone()
        if not fila or not fila["codigo_clave"] or fila["codigo_clave"] != codigo:
            flash("El código no es válido o aún no fue aprobado por el administrador.", "error")
            return render_template("recuperar_clave.html"), 400
        db = get_db()
        db.execute(
            "UPDATE usuarios SET clave_hash = ? WHERE id = ?",
            (generate_password_hash(clave), fila["usuario_id"]),
        )
        db.execute(
            "UPDATE recuperaciones SET estado = 'Usada', resuelto_en = ? WHERE id = ?",
            (datetime.now().isoformat(timespec="seconds"), fila["id"]),
        )
        db.commit()
        flash("Contraseña actualizada. Ya puedes ingresar.", "ok")
        return redirect(url_for("ingresar"))
    return render_template("recuperar_clave.html")


@app.route("/perfil")
@login_required()
def perfil():
    return render_template("perfil.html")


@app.route("/reportar", methods=["GET", "POST"])
@login_required("ciudadano")
def reportar():
    user = usuario_actual()
    if user["estado"] != "Verificado":
        flash("Tu cuenta aún no está verificada. Espera a que el administrador valide tu DNI.", "error")
        return redirect(url_for("perfil"))
    db = get_db()
    categorias = db.execute(
        """
        SELECT c.*, a.nombre AS area_nombre, a.dependencia
        FROM categorias c JOIN areas a ON a.id = c.area_id
        ORDER BY c.nombre
        """
    ).fetchall()

    if request.method == "POST":
        errores = []
        descripcion = (request.form.get("descripcion") or "").strip()
        referencia = (request.form.get("referencia") or "").strip()
        direccion_mapa = (request.form.get("direccion_mapa") or "").strip()
        categoria_raw = request.form.get("categoria_id")
        lat_raw = request.form.get("lat")
        lng_raw = request.form.get("lng")
        foto = request.files.get("foto")
        referencias = [f for f in request.files.getlist("fotos_referencia") if f.filename]

        if not descripcion or len(descripcion) < 10:
            errores.append("Describe la incidencia con al menos 10 caracteres.")

        catalogo = None
        try:
            categoria_id = int(categoria_raw)
            catalogo = consultar_catalogo_categoria(categoria_id)
            if catalogo is None:
                errores.append("La categoría no se encontró en el catálogo.")
        except (TypeError, ValueError):
            errores.append("Selecciona una categoría válida.")

        try:
            lat = float(lat_raw)
            lng = float(lng_raw)
            if not ubicacion_valida(lat, lng):
                errores.append("La ubicación no es válida. Selecciona un punto con coordenadas válidas en el mapa.")
        except (TypeError, ValueError):
            errores.append("Marca la ubicación en el mapa o usa tu GPS.")

        if not foto or not foto.filename:
            errores.append("Adjunta una foto de la incidencia.")
        elif not allowed_file(foto.filename):
            errores.append("La foto debe ser JPG, PNG o WEBP.")

        if any(not allowed_file(f.filename) for f in referencias):
            errores.append("Las fotos de referencia deben ser JPG, PNG o WEBP.")

        if errores:
            for e in errores:
                flash(e, "error")
            return render_template("registrar.html", categorias=categorias), 400

        nombre_foto = guardar_archivo(foto, UPLOAD_FOTOS)
        reporte = registrar_reporte(
            {
                "foto": nombre_foto,
                "lat": lat,
                "lng": lng,
                "descripcion": descripcion,
                "ciudadano_nombre": user["nombre"],
                "ciudadano_contacto": user["telefono"],
                "categoria_id": catalogo["categoria_id"],
                "area_id": catalogo["area_id"],
                "usuario_id": user["id"],
                "referencia": referencia,
                "direccion_mapa": direccion_mapa,
            }
        )
        guardar_referencias(reporte["id"], referencias)
        clasificar_reporte(reporte["id"], catalogo["categoria_id"])
        asignar_responsable(reporte["id"], catalogo["area_id"])
        generar_notificacion(
            reporte["id"],
            f"Tu reporte {reporte['codigo']} fue registrado y asignado a "
            f"{catalogo['area_nombre']}. Estado: Reportado.",
        )
        crear_alertas(
            f"Nueva incidencia {reporte['codigo']} ({catalogo['categoria_nombre']}) asignada a {catalogo['area_nombre']}.",
            reporte_id=reporte["id"],
            area_id=catalogo["area_id"],
        )
        flash(
            f"Incidencia registrada. Código {reporte['codigo']}. Área asignada: {catalogo['area_nombre']}.",
            "ok",
        )
        return redirect(url_for("detalle", codigo=reporte["codigo"]))

    return render_template("registrar.html", categorias=categorias)


@app.route("/mis-reportes")
@login_required("ciudadano")
def mis_reportes():
    user = usuario_actual()
    return render_template("mis_reportes.html", reportes=listar_reportes(usuario_id=user["id"]))


@app.route("/consultar", methods=["GET", "POST"])
def consultar():
    codigo = (request.values.get("codigo") or "").strip().upper()
    if request.method == "POST" or codigo:
        if not codigo:
            flash("Ingresa el código de tu reporte (ejemplo PR-2026-0001).", "error")
            return render_template("consulta.html")
        data = reporte_completo(codigo)
        if not data:
            flash("No se encontró un reporte con ese código.", "error")
            return render_template("consulta.html")
        return redirect(url_for("detalle", codigo=codigo))
    return render_template("consulta.html")


@app.route("/reporte/<codigo>")
def detalle(codigo: str):
    data = reporte_completo(codigo.upper())
    if not data:
        flash("No se encontró ese reporte.", "error")
        return redirect(url_for("consultar"))
    user = usuario_actual()
    if not (data["reporte"]["usuario_id"] == user["id"] or puede_atender(user,data["reporte"])):
        return render_template("estado_publico.html", reporte=data["reporte"])
    if user:
        get_db().execute(
            "UPDATE alertas SET leida = 1 WHERE usuario_id = ? AND reporte_id = ?",
            (user["id"], data["reporte"]["id"]),
        )
        get_db().commit()
    return render_template("detalle.html", puede_gestionar=bool(user and puede_atender(user, data["reporte"])), **data)


@app.route("/panel")
@login_required("operador")
def panel():
    user = usuario_actual()
    estado = request.args.get("estado") or None
    area_id = user["area_id"]
    reportes = listar_reportes(estado=estado, area_id=area_id) if area_id else []
    areas = get_db().execute("SELECT * FROM areas ORDER BY nombre").fetchall()
    return render_template(
        "municipalidad.html",
        reportes=reportes,
        areas=areas,
        estado_filtro=estado or "",
        area_filtro=area_id or "",
    )


@app.route("/alertas")
@login_required("operador")
def alertas():
    user = usuario_actual()
    filas = get_db().execute(
        """
        SELECT al.*, r.codigo AS reporte_codigo, r.lat, r.lng, r.estado AS reporte_estado
        FROM alertas al
        JOIN reportes r ON r.id = al.reporte_id
        WHERE al.usuario_id = ? AND r.area_id = ?
        ORDER BY al.id DESC
        """,
        (user["id"],user["area_id"]),
    ).fetchall()
    return render_template("alertas.html", alertas=filas)


@app.route("/alertas/leer-todas", methods=["POST"])
@login_required("operador")
def leer_alertas():
    user = usuario_actual()
    get_db().execute("UPDATE alertas SET leida = 1 WHERE usuario_id = ? AND reporte_id IN (SELECT id FROM reportes WHERE area_id=?)", (user["id"], user["area_id"]))
    get_db().commit()
    return redirect(url_for("alertas"))


@app.route("/municipalidad/ingresar", methods=["GET", "POST"])
def municipal_login():
    return redirect(url_for("ingresar"))


@app.route("/municipalidad")
def municipalidad():
    return redirect(url_for("panel"))


@app.route("/municipalidad/salir")
def municipal_logout():
    return redirect(url_for("salir"))


@app.route("/municipalidad/reporte/<codigo>", methods=["GET", "POST"])
@login_required("operador")
def atender(codigo: str):
    user = usuario_actual()
    data = reporte_completo(codigo.upper())
    if not data:
        flash("No se encontró ese reporte.", "error")
        return redirect(url_for("panel"))
    if not puede_atender(user, data["reporte"]):
        flash("Este reporte no está asignado a tu área.", "error")
        return redirect(url_for("panel"))

    if request.method == "POST":
        accion = request.form.get("accion")
        reporte = data["reporte"]

        if accion == "estado":
            nuevo = request.form.get("estado")
            try:
                actualizar_estado(reporte["id"], nuevo)
            except ValueError:
                flash("Estado no permitido.", "error")
                return redirect(url_for("atender", codigo=codigo))
            generar_notificacion(
                reporte["id"],
                f"El reporte {reporte['codigo']} cambió a estado: {nuevo}.",
            )
            flash(f"Estado actualizado a {nuevo}. Se notificó al ciudadano.", "ok")

        elif accion == "evidencia":
            fotos = [f for f in request.files.getlist("fotografia") if f.filename]
            if not fotos or any(not allowed_file(f.filename) for f in fotos):
                flash("Adjunta una fotografía válida de la atención.", "error")
                return redirect(url_for("atender", codigo=codigo))
            fecha = datetime.now().strftime("%d/%m/%Y")
            for foto in fotos:
                nombre_foto = guardar_archivo(foto, UPLOAD_EVIDENCIAS)
                registrar_evidencia(reporte["id"], nombre_foto, fecha)
            generar_notificacion(
                reporte["id"],
                f"Se registró evidencia de atención en el reporte {reporte['codigo']}.",
            )
            flash("Evidencia registrada y ciudadano notificado.", "ok")

        elif accion == "verificar":
            get_db().execute(
                """
                UPDATE reportes SET verificado_sitio = 1, operador_id = ?
                WHERE id = ?
                """,
                (user["id"], reporte["id"]),
            )
            if reporte["estado"] == "Reportado":
                actualizar_estado(reporte["id"], "En proceso")
            generar_notificacion(
                reporte["id"],
                f"El operador verificó en sitio el reporte {reporte['codigo']}.",
            )
            flash("Ubicación verificada en campo.", "ok")

        return redirect(url_for("atender", codigo=codigo))

    get_db().execute(
        "UPDATE alertas SET leida = 1 WHERE usuario_id = ? AND reporte_id = ?",
        (user["id"], data["reporte"]["id"]),
    )
    get_db().commit()
    return render_template("atender.html", **data)


@app.route("/admin/cuentas", methods=["GET", "POST"])
@login_required("administrador")
def cuentas():
    db = get_db()
    if request.method == "POST":
        recuperacion_correo.verificar_csrf()
        nombre = (request.form.get("nombre") or "").strip()
        usuario = (request.form.get("usuario") or "").strip().lower()
        dni = (request.form.get("dni") or "").strip()
        telefono = (request.form.get("telefono") or "").strip()
        clave = request.form.get("clave") or ""
        try:
            area_id = int(request.form.get("area_id"))
        except (TypeError, ValueError):
            area_id = 0
        area = db.execute("SELECT id FROM areas WHERE id = ?", (area_id,)).fetchone()
        errores = []
        if len(nombre) < 5:
            errores.append("Nombre del operador incompleto.")
        if len(usuario) < 4:
            errores.append("Usuario demasiado corto.")
        if not DNI_RE.match(dni):
            errores.append("DNI de 8 dígitos.")
        if not CEL_RE.match(telefono):
            errores.append("Celular inválido.")
        if len(clave) < 6:
            errores.append("Contraseña de al menos 6 caracteres.")
        if not area:
            errores.append("Selecciona el área que recibirá las alertas.")
        if db.execute("SELECT id FROM usuarios WHERE usuario = ?", (usuario,)).fetchone():
            errores.append("Ese usuario ya existe.")
        if db.execute("SELECT id FROM usuarios WHERE dni = ?", (dni,)).fetchone():
            errores.append("Ese DNI ya existe.")
        if errores:
            for e in errores:
                flash(e, "error")
        else:
            ahora = datetime.now().isoformat(timespec="seconds")
            db.execute(
                """
                INSERT INTO usuarios (
                    codigo, rol, usuario, clave_hash, nombre, dni, telefono, direccion,
                    estado, area_id, creado_en, verificado_en
                ) VALUES (?, 'operador', ?, ?, ?, ?, ?, ?, 'Verificado', ?, ?, ?)
                """,
                (
                    siguiente_codigo("US", "usuarios"),
                    usuario,
                    generate_password_hash(clave),
                    nombre,
                    dni,
                    telefono,
                    "Municipalidad de Puno",
                    area_id,
                    ahora,
                    ahora,
                ),
            )
            if getattr(db, "postgres", False):
                db.execute("UPDATE public.usuario SET id_entidad=(SELECT id_entidad FROM public.area_entidad WHERE id_area=?) WHERE usuario=?", (area_id, usuario))
            db.commit()
            flash(f"Operador {usuario} creado. Recibirá las alertas de su área.", "ok")
        return redirect(url_for("cuentas",vista="cuentas"))

    gestion = request.args.get("vista") == "cuentas"
    q = request.args.get("q", "").strip()[:150]
    estados = ("Pendiente","Verificado","Suspendido","Rechazado") if gestion else ("Pendiente","Aprobada","Usada","Rechazada")
    areas = db.execute("SELECT * FROM areas ORDER BY nombre").fetchall()
    sql = ("SELECT u.*, a.nombre AS area_nombre FROM usuarios u LEFT JOIN areas a ON a.id=u.area_id"
           if gestion else "SELECT r.*,u.nombre,u.usuario,u.dni,u.telefono FROM recuperaciones r JOIN usuarios u ON u.id=r.usuario_id")
    condiciones, params = [], []
    if q:
        campos = ["u.nombre","u.usuario","u.dni"] + (["a.nombre"] if gestion else ["r.codigo","r.correo_recuperacion"])
        condiciones.append("(" + " OR ".join("LOWER("+campo+") LIKE LOWER(?) ESCAPE '!'" for campo in campos) + ")")
        patron = "%" + q.replace("!","!!").replace("%","!%").replace("_","!_") + "%"
        params.extend([patron]*len(campos))
    if request.args.get("estado") in estados:
        condiciones.append(("u" if gestion else "r")+".estado=?"); params.append(request.args["estado"])
    if gestion and request.args.get("rol") in ("ciudadano","operador","administrador"):
        condiciones.append("u.rol=?"); params.append(request.args["rol"])
    if gestion and request.args.get("area_id",type=int):
        condiciones.append("u.area_id=?"); params.append(request.args.get("area_id",type=int))
    if condiciones: sql += " WHERE " + " AND ".join(condiciones)
    sql += " ORDER BY u.nombre,u.id" if gestion else " ORDER BY CASE WHEN r.estado='Pendiente' THEN 0 ELSE 1 END,r.id DESC"
    filas = db.execute(sql, params).fetchall()
    return render_template("cuentas.html", gestion=gestion, estados=estados, areas=areas,
                           personas=filas if gestion else [], recuperaciones=[] if gestion else filas)


@app.route("/admin/usuario/<int:uid>", methods=["GET", "POST"])
@login_required("administrador")
def cuenta_detalle(uid: int):
    db = get_db()
    persona = db.execute(
        """
        SELECT u.*, a.nombre AS area_nombre
        FROM usuarios u LEFT JOIN areas a ON a.id = u.area_id
        WHERE u.id = ?
        """,
        (uid,),
    ).fetchone()
    if not persona:
        flash("Usuario no encontrado.", "error")
        return redirect(url_for("cuentas"))
    if request.method == "POST":
        accion = request.form.get("accion")
        motivo = (request.form.get("motivo") or "").strip()
        ahora = datetime.now().isoformat(timespec="seconds")
        recuperacion_correo.verificar_csrf()
        if persona["rol"] == "operador":
            if accion == "editar":
                area_id = request.form.get("area_id", type=int)
                nombre = request.form.get("nombre","").strip()
                telefono = request.form.get("telefono","").strip()
                clave = request.form.get("clave","")
                if not (5 <= len(nombre) <= 120 and CEL_RE.fullmatch(telefono) and
                        db.execute("SELECT id FROM areas WHERE id=?", (area_id,)).fetchone()
                        and (not clave or 8 <= len(clave) <= 256)):
                    flash("Revisa el nombre, el celular, el área y la contraseña opcional (mínimo 8 caracteres).","error")
                    return redirect(url_for("cuenta_detalle",uid=uid))
                db.execute("UPDATE usuarios SET nombre=?, telefono=?, area_id=?, clave_hash=? WHERE id=? AND rol='operador'",
                           (nombre,telefono,area_id,generate_password_hash(clave) if clave else persona["clave_hash"],uid))
                if getattr(db, "postgres", False):
                    db.execute("UPDATE public.usuario SET id_entidad=(SELECT id_entidad FROM public.area_entidad WHERE id_area=?) WHERE id_usuario=?", (area_id, uid))
            elif accion in ("suspender","reactivar"):
                db.execute("UPDATE usuarios SET estado=? WHERE id=? AND rol='operador'",
                           ("Suspendido" if accion=="suspender" else "Verificado",uid))
            else: abort(400)
            db.commit()
            flash("Cuenta de entidad actualizada.","ok")
            return redirect(url_for("cuenta_detalle",uid=uid))
        if persona["rol"] != "ciudadano": abort(403)
        if accion == "verificar":
            db.execute(
                "UPDATE usuarios SET estado = 'Verificado', verificado_en = ?, motivo = NULL WHERE id = ?",
                (ahora, uid),
            )
            flash(f"{persona['nombre']} quedó verificado.", "ok")
        elif accion == "rechazar":
            db.execute(
                "UPDATE usuarios SET estado = 'Rechazado', motivo = ? WHERE id = ?",
                (motivo or "DNI o datos no coinciden.", uid),
            )
            flash("Cuenta rechazada.", "ok")
        elif accion == "suspender":
            db.execute(
                "UPDATE usuarios SET estado = 'Suspendido', motivo = ? WHERE id = ?",
                (motivo or "Suspendido por la municipalidad.", uid),
            )
            flash("Cuenta suspendida.", "ok")
        db.commit()
        return redirect(url_for("cuenta_detalle", uid=uid))
    areas = db.execute("SELECT * FROM areas ORDER BY nombre").fetchall() if persona["rol"]=="operador" else []
    return render_template("cuenta_detalle.html", persona=persona, areas=areas)


@app.route("/admin/dni/<nombre>")
@login_required("administrador")
def ver_dni(nombre: str):
    seguro = Path(nombre).name
    destino = UPLOAD_DNI / seguro
    if not destino.exists():
        abort(404)
    return send_from_directory(UPLOAD_DNI, seguro)


@app.route("/admin/recuperacion/<int:rid>", methods=["POST"])
@login_required("administrador")
def resolver_recuperacion(rid: int):
    db = get_db()
    fila = db.execute(
        """
        SELECT r.*, u.nombre, u.usuario FROM recuperaciones r
        JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?
        """,
        (rid,),
    ).fetchone()
    if not fila:
        flash("Solicitud no encontrada.", "error")
        return redirect(url_for("cuentas"))
    if fila["correo_recuperacion"]:
        return recuperacion_correo.resolver(fila)
    accion = request.form.get("accion")
    ahora = datetime.now().isoformat(timespec="seconds")
    if accion == "aprobar":
        codigo = f"{secrets.randbelow(1_000_000):06d}"
        db.execute(
            "UPDATE recuperaciones SET estado = 'Aprobada', codigo_clave = ?, resuelto_en = ? WHERE id = ?",
            (codigo, ahora, rid),
        )
        db.commit()
        flash(f"Código para {fila['usuario']}: {codigo}. Entrégaselo al ciudadano.", "ok")
    elif accion == "rechazar":
        db.execute(
            "UPDATE recuperaciones SET estado = 'Rechazada', resuelto_en = ? WHERE id = ?",
            (ahora, rid),
        )
        db.commit()
        flash("Solicitud rechazada.", "ok")
    return redirect(url_for("cuentas"))


import recuperacion_correo
recuperacion_correo.instalar(app, get_db, siguiente_codigo, crear_alertas, login_required, BASE_DIR)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--https", action="store_true", help="Acceso HTTPS local para GPS movil")
    args = parser.parse_args()
    init_db()
    if args.https:
        from https_local import preparar_https

        cert, key, ips = preparar_https(BASE_DIR)
        app.config["SESSION_COOKIE_SECURE"] = True
        print("\nInstala una vez private/https/puno-reporta-local.crt en el telefono como certificado de CA.", flush=True)
        print("Copia SOLO ese .crt al telefono por USB. No copies los archivos de claves.", flush=True)
        print("Consulta MOVIL.md para los pasos. Ambos equipos deben estar en el mismo Wi-Fi.", flush=True)
        for ip in ips:
            print(f"  Abrir: https://{ip}:5443", flush=True)
        app.run(host="0.0.0.0", port=5443, ssl_context=(cert, key), debug=False)
    else:
        app.run(host="0.0.0.0", port=5000, debug=False)
