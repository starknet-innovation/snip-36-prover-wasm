"""Prevent a frontend deployment from silently using stale release modules."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("release_profile", ROOT / "scripts/check-release-profile.py")
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)


class ReleaseProfileTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "evidence").mkdir()
        (self.root / "pins.json").write_text('{"profile":"V2"}')
        for name in ["executor", "prover"]:
            p = self.root / "patches" / name
            p.mkdir(parents=True)
            (p / "port.patch").write_text("reviewed patch\n")
        profile.source_assets.ROOT = self.root
        self.manifest = {"release": "v1.0.0", "release_status": "published", "assets": [
            {"name": "prover.wasm", "path": "web/prover.wasm", "bytes": 8, "sha256": "a" * 64}]}
        self.evidence = {"release": "v1.0.0", "source_identity": profile.source_assets.identity(),
                         "modules": {a["path"]: {k: a[k] for k in ["path", "bytes", "sha256"]} for a in self.manifest["assets"]}}
        (self.root / "evidence/release-v1.0.0.json").write_text(json.dumps(self.evidence))
        self.save_manifest()

    def save_manifest(self):
        (self.root / "assets.json").write_text(json.dumps(self.manifest))

    def test_validated_release_is_accepted(self):
        profile.verify(self.root)

    def test_pin_or_patch_change_rejects_stale_release(self):
        for name in ["pins.json", "patches/executor/port.patch", "patches/prover/port.patch"]:
            p = self.root / name
            original = p.read_bytes()
            p.write_bytes(original + b"\n")
            with self.assertRaisesRegex(ValueError, "source profile differs"):
                profile.verify(self.root)
            p.write_bytes(original)

    def test_unpublished_traversal_and_module_changes_are_rejected(self):
        self.manifest["release_status"] = "unpublished"
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "published, validated"):
            profile.verify(self.root)
        self.manifest["release_status"] = "published"
        self.manifest["release"] = "../elsewhere"
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "published, validated"):
            profile.verify(self.root)
        self.manifest["release"] = "v1.0.0"
        self.manifest["assets"][0]["sha256"] = "b" * 64
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "module identities differ"):
            profile.verify(self.root)


if __name__ == "__main__":
    unittest.main()
