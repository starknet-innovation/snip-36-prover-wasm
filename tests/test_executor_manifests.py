"""Fail closed if Dependabot's resolver differs from the real source inputs."""

from pathlib import Path
import hashlib
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from executor_manifests import check_manifests, patch_fingerprint


class ExecutorManifestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = Path(self.directory.name) / "source"
        self.mirror = Path(self.directory.name) / "mirror"
        for tree in (self.source, self.mirror):
            (tree / "crates/member").mkdir(parents=True)
            (tree / "Cargo.toml").write_text('[workspace]\nmembers = ["crates/member"]\n')
            (tree / "crates/member/Cargo.toml").write_text('[package]\nname = "member"\nversion = "0.1.0"\n')

    def test_matching_workspace(self):
        self.assertEqual(len(check_manifests(self.source, self.mirror)), 2)

    def test_missing_workspace_member_fails(self):
        (self.mirror / "crates/member/Cargo.toml").unlink()
        with self.assertRaisesRegex(ValueError, "missing=.*crates/member"):
            check_manifests(self.source, self.mirror)

    def test_extra_manifest_fails(self):
        (self.mirror / "crates/Cargo.toml").write_text("[workspace]\n")
        with self.assertRaisesRegex(ValueError, "extra=.*crates/Cargo.toml"):
            check_manifests(self.source, self.mirror)

    def test_dependency_edit_without_source_patch_fails(self):
        with (self.mirror / "crates/member/Cargo.toml").open("a") as file:
            file.write('[dependencies]\nlru = "0.16.3"\n')
        with self.assertRaisesRegex(ValueError, "changed=.*crates/member"):
            check_manifests(self.source, self.mirror)

    def test_nested_manifest_change_invalidates_prepared_sources(self):
        before = patch_fingerprint(self.mirror)
        with (self.mirror / "crates/member/Cargo.toml").open("a") as file:
            file.write('[dependencies]\nlru = "0.16.3"\n')
        self.assertNotEqual(before, patch_fingerprint(self.mirror))

    def test_renamed_manifest_invalidates_prepared_sources(self):
        before = patch_fingerprint(self.mirror)
        (self.mirror / "crates/member/Cargo.toml").rename(self.mirror / "crates/Cargo.toml")
        self.assertNotEqual(before, patch_fingerprint(self.mirror))

    def test_unused_upstream_manifest_is_not_a_resolver_input(self):
        (self.source / "unsupported").mkdir()
        (self.source / "unsupported/Cargo.toml").write_text('[package]\nname = "unsupported"\nversion = "0.1.0"\n')
        self.assertEqual(len(check_manifests(self.source, self.mirror)), 2)

    def test_committed_executor_lock_is_outside_remaining_advisory_ranges(self):
        root = Path(__file__).resolve().parents[1]
        packages = tomllib.loads((root / "patches/executor/Cargo.lock").read_text())["package"]
        minima = {"lru": (0, 16, 3), "pyo3": (0, 29, 0),
                  "hickory-proto": (0, 26, 1), "yamux": (0, 13, 10),
                  "jsonwebtoken": (10, 3, 0), "rustls": (0, 23, 46),
                  "zip": (9, 0, 5), "aws-lc-sys": (0, 39, 0),
                  "bytes": (1, 11, 1), "keccak": (0, 1, 6),
                  "openssl": (0, 10, 80), "quinn-proto": (0, 11, 15),
                  "rand": (0, 8, 6), "ruint": (1, 17, 2),
                  "rustls-webpki": (0, 103, 13), "serde_with": (3, 21, 0),
                  "thin-vec": (0, 2, 16), "time": (0, 3, 47),
                  "xxhash-rust": (0, 8, 16)}
        for package in packages:
            minimum = minima.get(package["name"])
            if minimum is not None:
                self.assertNotIn("-", package["version"])
                version = tuple(map(int, package["version"].split(".")))
                self.assertGreaterEqual(version, minimum, package)
        requirements = (root / "patches/executor/python-requirements.txt").read_text()
        self.assertFalse(any(line.startswith("ecdsa==") for line in requirements.splitlines()))
        certifi = next(line.split("==")[1] for line in requirements.splitlines()
                       if line.startswith("certifi=="))
        self.assertGreaterEqual(tuple(map(int, certifi.split("."))), (2026, 10, 18))

    def test_vm_security_patch_preserves_execution_sources(self):
        root = Path(__file__).resolve().parents[1] / "patches/executor"
        archive = root / "cairo-vm-3.2.0.crate"
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(),
                         "38fb2559063ab5f35c1596b6b79a8a18809306a419a3cbd141c2149639386da9")
        with tempfile.TemporaryDirectory() as directory:
            with tarfile.open(archive) as package:
                package.extractall(directory, filter="data")
            source = Path(directory) / "cairo-vm-3.2.0"
            before = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
            subprocess.run(["git", "apply", str(root / "cairo-vm-zip.patch")], cwd=source, check=True)
            self.assertEqual(set(before), {p.relative_to(source) for p in source.rglob("*") if p.is_file()})
            changed = {p for p, data in before.items() if (source / p).read_bytes() != data}
            self.assertEqual(changed, {Path("Cargo.toml"), Path("src/lib.rs"),
                                       Path("src/vm/runners/cairo_pie.rs")})
            self.assertEqual((source / "src/lib.rs").read_bytes(), before[Path("src/lib.rs")].replace(
                b"#![deny(warnings)]", b"#![deny(warnings)]\n#![allow(unused_parens)]"))
            writer = Path("src/vm/runners/cairo_pie.rs")
            self.assertEqual((source / writer).read_bytes(), before[writer].replace(
                b"zip::write::FileOptions::default()", b"zip::write::SimpleFileOptions::default()"))
            self.assertEqual((source / "Cargo.toml").read_bytes(),
                             (root / "browser-vendor/cairo-vm-3.2.0/Cargo.toml").read_bytes())


if __name__ == "__main__":
    unittest.main()
