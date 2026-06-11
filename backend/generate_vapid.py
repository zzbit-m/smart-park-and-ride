"""
One-time VAPID key generator for Web Push notifications.

Usage:
    python generate_vapid.py

Copy the printed lines into your .env file.
Requires: cryptography (installed via python-jose[cryptography])
"""
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid


def main():
    v = Vapid()
    v.generate_keys()

    assert v.private_key is not None
    assert v.public_key is not None

    priv_pem = v.private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    pub_raw = v.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    pub_b64 = base64.urlsafe_b64encode(pub_raw).rstrip(b"=").decode()

    print(f"VAPID_PRIVATE_KEY={priv_pem}")
    print(f"VAPID_PUBLIC_KEY={pub_b64}")


if __name__ == "__main__":
    main()
