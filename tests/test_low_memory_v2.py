"""Check the exact release patch and isolation between optimized/stock preparation."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('prepare', ROOT / 'scripts/prepare-sources.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class LowMemoryV2(unittest.TestCase):
    def test_reviewed_release_patch_is_exact(self):
        pins = json.loads((ROOT / 'pins.json').read_text())
        self.assertEqual(pins['backend_release'], 'v1.4.2')
        self.assertEqual(pins['prover_profile'], 'low-memory-v2')
        self.assertEqual(pins['low_memory_patch_sha256'],
                         '88132044b4a11cd3369d193d568eaf97d80cd9556b81e1c9445a6fa0d32359d4')
        self.assertEqual(hashlib.sha256((ROOT / 'patches/prover/low-memory-v2.patch').read_bytes()).hexdigest(),
                         pins['low_memory_patch_sha256'])

    def test_layered_preparation_is_repeatable_and_rejects_stock_receipts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'proving'
            source.mkdir()
            subprocess.run(['git', 'init', '-q', str(source)], check=True)
            (source / 'lib.rs').write_text('upstream\n')
            subprocess.run(['git', '-C', str(source), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(source), '-c', 'user.name=Test',
                            '-c', 'user.email=test@example.com', 'commit', '-qm', 'pin'], check=True)
            patches = root / 'patches'
            patches.mkdir()
            def replacement(before, after):
                return f'diff --git a/lib.rs b/lib.rs\n--- a/lib.rs\n+++ b/lib.rs\n@@ -1 +1 @@\n-{before}\n+{after}\n'
            (patches / 'proving.patch').write_text(replacement('upstream', 'portable'))
            optimization = patches / 'low-memory-v2.patch'
            optimization.write_text(replacement('portable', 'optimized'))
            (patches / 'lock').write_text('reviewed lock\n')
            with tarfile.open(patches / 'vendor.tar.gz', 'w:gz'):
                pass
            expected = hashlib.sha256(optimization.read_bytes()).hexdigest()
            def run(low_memory):
                prepare.prepare_browser(source, patches, 'proving.patch', 'lock',
                                        'vendor.tar.gz', low_memory=low_memory)
            with patch.object(prepare, 'PINS', {'low_memory_patch_sha256': expected}):
                run(True)
                self.assertEqual((source / 'lib.rs').read_text(), 'optimized\n')
                run(True)
                with self.assertRaisesRegex(RuntimeError, 'patch set changed'):
                    run(False)
                with patch.object(prepare, 'PINS', {'low_memory_patch_sha256': '0' * 64}):
                    with self.assertRaisesRegex(ValueError, 'reviewed backend release'):
                        run(True)
                (source / 'lib.rs').write_text('edited\n')
                with self.assertRaisesRegex(RuntimeError, 'sources changed'):
                    run(True)
