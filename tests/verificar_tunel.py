"""Entrada compatible; las pruebas se ejecutan y reportan por separado con pytest."""
import sys
from pathlib import Path

if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([str(Path(__file__).with_name("test_acceso.py")), "-m", "not postgres", "-q"]))
