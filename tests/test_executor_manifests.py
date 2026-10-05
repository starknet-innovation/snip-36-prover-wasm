"""Fail closed if Dependabot's resolver differs from the real source inputs."""

from pathlib import Path
import sys
import tempfile
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


if __name__ == "__main__":
    unittest.main()
