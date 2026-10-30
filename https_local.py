"""Certificados para HTTPS en la red local, sin publicar la aplicacion."""
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from pathlib import Path
import socket

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def direcciones_locales():
    direcciones = {"127.0.0.1"}
    try:
        direcciones.update(r[4][0] for r in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    return sorted(direcciones)


def preparar_https(base: Path):
    carpeta = base / "private" / "https"
    carpeta.mkdir(parents=True, exist_ok=True)
    ca_key_path = carpeta / "ca-key.pem"
    ca_path = carpeta / "puno-reporta-local.crt"
    ahora = datetime.now(timezone.utc)
    if ca_key_path.exists() and ca_path.exists():
        ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
        ca = x509.load_pem_x509_certificate(ca_path.read_bytes())
        if ca.not_valid_after_utc <= ahora + timedelta(days=2):
            raise RuntimeError("El certificado local vencio. Renueva la carpeta private/https e instala el nuevo certificado en el telefono.")
    elif ca_key_path.exists() or ca_path.exists():
        raise RuntimeError("Falta una parte del certificado local. Restaura private/https antes de continuar.")
    else:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Puno Reporta - CA local")])
        ca = (x509.CertificateBuilder().subject_name(nombre).issuer_name(nombre)
              .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(ahora - timedelta(minutes=5)).not_valid_after(ahora + timedelta(days=730))
              .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
              .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))
        ca_key_path.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        ca_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    ips = direcciones_locales()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Puno Reporta local")]))
            .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(ahora - timedelta(minutes=5))
            .not_valid_after(min(ahora + timedelta(days=90), ca.not_valid_after_utc))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")] + [x509.IPAddress(ip_address(ip)) for ip in ips]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), critical=True)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    cert_path, key_path = carpeta / "server.pem", carpeta / "server-key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return str(cert_path), str(key_path), ips
