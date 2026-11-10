"""Fetch the v1.4.0 transaction-service sources and apply browser portability patches."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

from executor_manifests import check_manifests, patch_fingerprint

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


def prepare_browser(source, patch_dir, patch_name, lock_name, archive_name):
    marker = source / ".wasm-patches-complete"
    fingerprint = patch_fingerprint(patch_dir)
    if marker.exists():
        if marker.read_text() != fingerprint:
            raise ValueError(f"Browser patch set changed; use a fresh {source}")
    else:
        # The archives contain dependency sources and retain their upstream licenses.
        with tarfile.open(patch_dir / archive_name) as archive:
            archive.extractall(source, filter="data")
        patch = patch_dir / patch_name
        run("git", "-C", str(source), "apply", "--check", str(patch))
        run("git", "-C", str(source), "apply", str(patch))
        if patch_name == "v2.patch":
            shutil.copytree(patch_dir / "browser-vendor/num-prime-0.4.4",
                            source / "browser-vendor/num-prime-0.4.4", dirs_exist_ok=True)
            check_manifests(source)
        (source / "Cargo.lock").write_bytes((patch_dir / lock_name).read_bytes())
        marker.write_text(fingerprint)
    if (source / "Cargo.lock").read_bytes() != (patch_dir / lock_name).read_bytes():
        raise ValueError(f"Prepared browser lock differs in {source}")
    if patch_name == "v2.patch":
        check_manifests(source)
    print(f"Prepared {source}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prover", "native", "executor"])
    parser.add_argument("--build-dir", type=Path, default=ROOT / "build")
    args = parser.parse_args()
    build = args.build_dir.resolve()
    if args.mode == "executor":
        source = clone(build, "sequencer", "https://github.com/starkware-libs/sequencer.git", PINS["sequencer"])
        hashes = json.loads((source / "crates/apollo_starknet_os_program/src/program_hash.json").read_text())
        if hashes["virtual_os"] != PINS["program_hash"]:
            raise ValueError("Pinned virtual OS hash differs from upstream")
        prepare_browser(source, ROOT / "patches/executor", "v2.patch", "Cargo.lock", "v2-portable-vendor.tar.gz")
    else:
        source = clone(build, "proving" if args.mode == "prover" else "native-prover",
                       "https://github.com/starkware-libs/proving.git", PINS["transaction_service_proving"])
        if args.mode == "prover":
            prepare_browser(source, ROOT / "patches/prover", "proving.patch", "browser.Cargo.lock", "portable-vendor.tar.gz")
        else:
            # The native verifier uses upstream source and dependencies without portability patches.
            (source / "Cargo.lock").write_bytes((ROOT / "patches/prover/native.Cargo.lock").read_bytes())
            examples = source / "crates/privacy_prove/examples"
            examples.mkdir(exist_ok=True)
            shutil.copyfile(ROOT / "native/spike_native.rs", examples / "spike_native.rs")


if __name__ == "__main__":
    main()
