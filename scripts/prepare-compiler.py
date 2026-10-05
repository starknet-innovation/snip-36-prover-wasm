"""Prepare the pinned Cairo compiler without its unused ECDSA signing package.

This build-only variant retains compilation, hashing and verification. Signing
fails explicitly; no substitute cryptographic implementation is introduced.
"""

from pathlib import Path
import hashlib
import io
import shutil
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "build/compiler-source/cairo-lang-0.14.3a3"
URL = "https://files.pythonhosted.org/packages/62/b6/62c688d02c4c9667031d84379bdf77ed246ee963903f5f69f9558f0a2151/cairo_lang-0.14.3a3.tar.gz"
SHA256 = "8dc49e263d4251c4cf1c9772fe1b212d0f8b4e2c024d32a5584b496e4f20bd98"
VERSION = "0.14.3a3+snip36compiler1"
ORIGINALS = {
    "setup.py": "8835054fd61aecf36f7b90103433171d0236e3ea48cae7e8c3170cecf2243c3c",
    "requirements.txt": "3d060fff37cfbf49d7b3afe5c0a75d2ea96854d416807ce317b6637e269ff10e",
    "starkware/crypto/signature/signature.py": "13b59b2be8a5119a88bf12d698baacb546e27645812349d653262eb4f9a8b6c9",
    "starkware/cairo/lang/VERSION": "0eaa1143e21ce2f8b995fa5b192ae977132ecb653274e78bf9fceaa35f9ef007",
}


def prepare():
    cache = ROOT / ".cache/cairo-lang-0.14.3a3.tar.gz"
    if cache.exists():
        data = cache.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=120) as response:
            data = response.read(32 * 1024 * 1024 + 1)
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("Pinned Cairo compiler archive checksum differs")
    cache.parent.mkdir(exist_ok=True)
    cache.write_bytes(data)
    # Replace only this generated, fixed compiler source directory.
    if SOURCE.exists():
        shutil.rmtree(SOURCE)
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(SOURCE.parent, filter="data")
    for name, expected in ORIGINALS.items():
        if hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Compiler patch input differs: {name}")
    requirement = SOURCE / "requirements.txt"
    requirement.write_text(requirement.read_text().replace("ecdsa\n", "", 1))
    signature = SOURCE / "starkware/crypto/signature/signature.py"
    signature.write_text(signature.read_text().replace(
        "from ecdsa.rfc6979 import generate_k",
        'def generate_k(*_args, **_kwargs):\n'
        '    raise RuntimeError("Signing is disabled in the SNIP-36 compiler-only environment")',
        1,
    ))
    # Package metadata identifies our variant; compiler-visible VERSION stays
    # unchanged so it cannot change serialized class/program metadata.
    setup = SOURCE / "setup.py"
    setup.write_text(setup.read_text().replace(
        '.read().strip()', '.read().strip() + "+snip36compiler1"', 1,
    ))
    print(f"Prepared compiler-only Cairo {VERSION}")


if __name__ == "__main__":
    prepare()
