"""Node prueba el controlador real de IA con respuestas de Worker simuladas, sin descargar CLIP."""
from pathlib import Path
import shutil
import subprocess
import pytest

def test_interaccion_clasificador():
    node=shutil.which("node")
    if not node:
        pytest.skip("Pruebas de interfaz IA opcionales: instalar Node para ejecutar los 5 casos.")
    resultado=subprocess.run([node,"--test",str(Path(__file__).with_name("clasificador.test.cjs"))],
                             capture_output=True,text=True,encoding="utf-8",timeout=30)
    assert resultado.returncode==0, resultado.stdout+resultado.stderr
