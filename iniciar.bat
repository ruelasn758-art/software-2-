@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
echo.
echo Abre en el navegador: http://127.0.0.1:5000
echo Para el telefono: conecta ambos equipos al mismo Wi-Fi.
echo Abre la otra direccion que aparezca abajo en "Running on", distinta de 127.0.0.1.
echo La ubicacion automatica en el telefono necesita HTTPS.
echo Para GPS en el telefono sin certificados, abre iniciar_movil.bat.
echo Si activaste el enlace movil, consulta las claves en private\security\cuentas-locales.txt.
echo.
.\.venv\Scripts\python.exe app.py
