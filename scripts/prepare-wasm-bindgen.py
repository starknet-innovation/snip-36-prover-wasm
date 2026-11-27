"""Prepare the pinned wasm-bindgen CLI with deterministic cast-import order.

wasm-bindgen-cli-support 0.2.105 emits `__wbindgen_cast_*` imports in HashMap
iteration order, so two builds of identical input can order those imports
differently and shift every function index in the executor module. Later
upstream releases sort them; `patches/wasm-bindgen/cast-order.patch` backports
only that sort. Import names, JS glue and the crate/CLI schema version are
unchanged.
"""

from pathlib import Path
import hashlib
import io
import json
import re
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "pins.json").read_text())["executor_wasm_bindgen"]
SOURCE = ROOT / "build/wasm-bindgen-source"
PATCH = ROOT / "patches/wasm-bindgen/cast-order.patch"
CRATES = {
    "wasm-bindgen-cli": "0e6df6de37dde893edef52a54ef1277de313778e1fe3f1b678c15d98c93d3a50",
    "wasm-bindgen-cli-support": "0d3f73cd40cc5c6adf6a090e331f24595f87e7a5bd70ccf3db46be0e1d6e0d92",
}
PATCHED_FILE = "src/wit/mod.rs"
ORIGINAL_SHA256 = "83f9a325773b1e82efdb3f898c3079cdc2f4e055ce2741de7f00f523b8270c81"
PATCHED_SHA256 = "70a6451e433b61129e4538dc2164ea60fc9131e518980cc4547e1d1f6e23de5e"


def fetch(name):
    if VERSION != "0.2.105":
        raise ValueError("wasm-bindgen pin changed; update the crate checksums and cast-order patch")
    cache = ROOT / f".cache/{name}-{VERSION}.crate"
    if cache.exists():
        data = cache.read_bytes()
    else:
        url = f"https://static.crates.io/crates/{name}/{name}-{VERSION}.crate"
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read(16 * 1024 * 1024 + 1)
    if hashlib.sha256(data).hexdigest() != CRATES[name]:
        raise ValueError(f"Pinned {name} crate checksum differs")
    cache.parent.mkdir(exist_ok=True)
    cache.write_bytes(data)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(SOURCE, filter="data")
    return SOURCE / f"{name}-{VERSION}"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    # Replace only this generated, fixed tool source directory.
    if SOURCE.exists():
        shutil.rmtree(SOURCE)
    SOURCE.mkdir(parents=True)
    cli = fetch("wasm-bindgen-cli")
    support = fetch("wasm-bindgen-cli-support")
    if sha256(support / PATCHED_FILE) != ORIGINAL_SHA256:
        raise ValueError("wasm-bindgen patch input differs")
    subprocess.run(["patch", "-p1", "--batch", "--quiet", "-i", str(PATCH)], cwd=support, check=True)
    if sha256(support / PATCHED_FILE) != PATCHED_SHA256:
        raise ValueError("Patched wasm-bindgen source differs from the reviewed result")
    for leftover in support.rglob("*.orig"):
        leftover.unlink()

    manifest = cli / "Cargo.toml"
    manifest.write_text(
        manifest.read_text()
        + f'\n[patch.crates-io.wasm-bindgen-cli-support]\npath = "../wasm-bindgen-cli-support-{VERSION}"\n'
    )
    # A path patch has no registry source or checksum; every other locked
    # package, including the patched crate's dependency edges, stays exact.
    lock = cli / "Cargo.lock"
    entry = re.compile(
        r'(name = "wasm-bindgen-cli-support"\nversion = "' + re.escape(VERSION) + r'"\n)'
        r'source = "registry\+https://github.com/rust-lang/crates.io-index"\n'
        r'checksum = "' + CRATES["wasm-bindgen-cli-support"] + r'"\n'
    )
    text, count = entry.subn(r"\1", lock.read_text())
    if count != 1:
        raise ValueError("wasm-bindgen-cli lockfile entry differs")
    lock.write_text(text)
    print(f"Prepared wasm-bindgen-cli {VERSION} with deterministic cast-import order")


if __name__ == "__main__":
    prepare()
