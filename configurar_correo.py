"""Guarda localmente la contraseña de aplicación; nunca usa la contraseña personal."""
from pathlib import Path
import getpass
import json
import re

def main():
    print('Configurar Gmail: ruelasn758@gmail.com')
    print('Activa la verificación en dos pasos y crea una contraseña de aplicación en:')
    print('https://myaccount.google.com/apppasswords')
    print('La contraseña se escribe oculta. No pegues tu contraseña personal de Google.')
    clave=getpass.getpass('Contraseña de aplicación (16 letras; vacío cancela): ').replace(' ','')
    if not clave: return
    if not re.fullmatch('[a-zA-Z]{16}',clave):
        print('Se esperaban las 16 letras de una contraseña de aplicación. No se guardó nada.');return
    archivo=Path(__file__).resolve().parent/'private'/'correo'/'smtp.json'
    config=json.loads(archivo.read_text(encoding='utf-8-sig')) if archivo.exists() else {}
    config.update(username='ruelasn758@gmail.com',password=clave)
    archivo.parent.mkdir(parents=True,exist_ok=True)
    archivo.write_text(json.dumps(config,indent=2),encoding='utf-8')
    print('Configuración guardada en esta computadora. El administrador ya puede intentar enviar los enlaces.')
if __name__=='__main__': main()
