"""Small maintenance commands:  python -m app.cli <command>"""
import base64
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def vapid():
    """Prints a new key pair for Web Push. Put both lines in the server's environment; the private one must never leave the server."""
    key = ec.generate_private_key(ec.SECP256R1())
    b64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")  # noqa: E731
    priv = key.private_numbers().private_value.to_bytes(32, "big")
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    print(f"VAPID_PUBLIC_KEY={b64(pub)}\nVAPID_PRIVATE_KEY={b64(priv)}\nVAPID_SUBJECT=mailto:change-this@yourcompany.example")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "vapid":
        vapid()
    else:
        print("commands: vapid")
        sys.exit(2)
