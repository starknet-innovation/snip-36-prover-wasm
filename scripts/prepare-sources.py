"""Fetch the v1.4.2 transaction-service sources and apply browser portability patches."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

from executor_manifests import check_manifests, patch_fingerprint
from prover_sources import check_receipt, write_receipt, require_pristine

ROOT = Path(__file__).resolve().parents[1]
PINS = json.loads((ROOT / "pins.json").read_text())


def run(*args):
    subprocess.run(args, check=True)


def clone(build, name, url, revision):
    source = build / name
    if not (source / ".git").exists():
        source.mkdir(parents=True, exist_ok=True)
        run("git", "-C", str(source), "init")
        run("git", "-C", str(source), "remote", "add", "origin", url)
        run("git", "-C", str(source), "fetch", "--depth=1", "origin", revision)
        run("git", "-C", str(source), "checkout", "--detach", "FETCH_HEAD")
    actual = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != revision:
        raise ValueError(f"Unexpected revision in {source}; preserve it elsewhere and use a fresh directory")
    return source


def prepare_browser(source, patch_dir, patch_name, lock_name, archive_name, *, low_memory=False):
    if low_memory:
        optimization = patch_dir / "low-memory-v2.patch"
        if hashlib.sha256(optimization.read_bytes()).hexdigest() != PINS["low_memory_patch_sha256"]:
            raise ValueError("Low-memory patch differs from the reviewed backend release")
    marker = source / ".wasm-patches-complete"
    fingerprint = patch_fingerprint(patch_dir)
    # Stock and optimized trees must never share a preparation receipt.
    if patch_name == "proving.patch":
        fingerprint += ":low-memory-v2" if low_memory else ":stock-v2"
    trees = {source.name: source}
    if not check_receipt(marker, fingerprint, trees):
        require_pristine(trees)
        # The archives contain dependency sources and retain their upstream licenses.
        with tarfile.open(patch_dir / archive_name) as archive:
            archive.extractall(source, filter="data")
        patch = patch_dir / patch_name
        run("git", "-C", str(source), "apply", "--check", str(patch))
        run("git", "-C", str(source), "apply", str(patch))
        if low_memory:
            run("git", "-C", str(source), "apply", "--check", str(optimization))
            run("git", "-C", str(source), "apply", str(optimization))
        if patch_name == "v2.patch":
            # Retain the pinned VM; migrate only its ZIP dependency/API.
            with tarfile.open(patch_dir / "cairo-vm-3.2.0.crate") as archive:
                archive.extractall(source / "browser-vendor", filter="data")
            vm = source / "browser-vendor/cairo-vm-3.2.0"
            run("git", "-C", str(vm), "apply", "--check", str(patch_dir / "cairo-vm-zip.patch"))
            run("git", "-C", str(vm), "apply", str(patch_dir / "cairo-vm-zip.patch"))
            shutil.copytree(patch_dir / "browser-vendor/num-prime-0.4.4",
                            source / "browser-vendor/num-prime-0.4.4", dirs_exist_ok=True)
            check_manifests(source)
        (source / "Cargo.lock").write_bytes((patch_dir / lock_name).read_bytes())
        write_receipt(marker, fingerprint, trees)
    if (source / "Cargo.lock").read_bytes() != (patch_dir / lock_name).read_bytes():
        raise ValueError(f"Prepared browser lock differs in {source}")
    if patch_name == "v2.patch":
        check_manifests(source)
    print(f"Prepared {source}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prover", "prover-baseline", "native", "executor"])
    parser.add_argument("--build-dir", type=Path, default=ROOT / "build")
    args = parser.parse_args()
    build = args.build_dir.resolve()
    if not build.is_relative_to(ROOT / "build"):
        raise ValueError("Preparation directory must be under build/")
    if args.mode == "executor":
        source = clone(build, "sequencer", "https://github.com/starkware-libs/sequencer.git", PINS["sequencer"])
        hashes = json.loads((source / "crates/apollo_starknet_os_program/src/program_hash.json").read_text())
        if hashes["virtual_os"] != PINS["program_hash"]:
            raise ValueError("Pinned virtual OS hash differs from upstream")
        prepare_browser(source, ROOT / "patches/executor", "v2.patch", "Cargo.lock", "v2-portable-vendor.tar.gz")
    else:
        source = clone(build, {"prover": "proving", "prover-baseline": "proving-baseline", "native": "native-prover"}[args.mode],
                       "https://github.com/starkware-libs/proving.git", PINS["transaction_service_proving"])
        if args.mode in {"prover", "prover-baseline"}:
            prepare_browser(source, ROOT / "patches/prover", "proving.patch", "browser.Cargo.lock", "portable-vendor.tar.gz", low_memory=args.mode == "prover")
        else:
            # Only the committed lock and the diagnostic examples may differ from upstream.
            status = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=all"], text=True).splitlines()
            examples_allowed = {"?? crates/privacy_prove/examples/" + f.name for f in (ROOT / "native").glob("*.rs")}
            unexpected = [line for line in status if line != " M Cargo.lock" and line not in examples_allowed]
            if unexpected:
                raise ValueError("Native verifier source is not pristine: " + ", ".join(unexpected))
            (source / "Cargo.lock").write_bytes((ROOT / "patches/prover/native.Cargo.lock").read_bytes())
            examples = source / "crates/privacy_prove/examples"
            examples.mkdir(exist_ok=True)
            shutil.copyfile(ROOT / "native/spike_native.rs", examples / "spike_native.rs")


if __name__ == "__main__":
    main()
