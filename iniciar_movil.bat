@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto error
.\.venv\Scripts\python.exe acceso_movil.py
if errorlevel 1 goto error
exit /b 0
:error
echo No se pudo iniciar el enlace movil. Revisa el mensaje anterior.
pause
exit /b 1
