"""Conexion PostgreSQL; SQLite se conserva solo hasta activar la migracion."""
import json
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent
CONFIG = BASE / 'private' / 'postgres' / 'conexion.json'


def configuracion():
    if os.environ.get('PUNO_DB_BACKEND') == 'sqlite':
        return None
    archivo = Path(os.environ.get('PUNO_PG_CONFIG', str(CONFIG)))
    if archivo.exists():
        return json.loads(archivo.read_text(encoding='utf-8-sig'))
    if os.environ.get('PUNO_DB_BACKEND') == 'postgres':
        raise RuntimeError('Falta configurar la conexion PostgreSQL.')
    return None


class Fila(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


def fila_factory(cursor):
    nombres = [c.name for c in (cursor.description or ())]
    return lambda values: Fila(zip(nombres, values))


class Conexion:
    postgres = True

    def __init__(self, config, actor=None, ip=None):
        import psycopg
        self.raw = psycopg.connect(**config, row_factory=fila_factory)
        self.actor = actor
        self.ip = ip
        self._contexto()

    def _contexto(self):
        self.raw.execute('SET search_path TO compat, public')
        self.raw.execute("SELECT set_config('puno.usuario_id', %s, false), set_config('puno.ip', %s, false)", (str(self.actor or ''), self.ip or ''))

    def execute(self, sql, params=()):
        # Las consultas existentes usan ? como parametro; no se interpolan valores.
        return self.raw.execute(sql.replace('?', '%s'), params or None)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        self.raw.close()


def conectar(actor=None, ip=None):
    config = configuracion()
    return Conexion(config, actor, ip) if config else None
