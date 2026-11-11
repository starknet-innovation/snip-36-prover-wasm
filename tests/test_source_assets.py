"""Reject stale builds and modified modules before using source-built assets."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
spec = importlib.util.spec_from_file_location('source_assets', Path(__file__).resolve().parents[1] / 'scripts/source-assets.py')
source_assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_assets)


class SourceAssetTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.receipt = self.root / 'build/source-assets.json'
        self.receipt.parent.mkdir()
        for name in ['executor', 'prover']:
            directory = self.root / 'patches' / name
            directory.mkdir(parents=True)
            (directory / 'source.patch').write_text('reviewed portability patch\n')
        (self.root / 'pins.json').write_text('{"profile":"V2"}\n')
        self.root_patch = patch.object(source_assets, 'ROOT', self.root)
        self.receipt_patch = patch.object(source_assets, 'RECEIPT', self.receipt)
        self.root_patch.start()
        self.receipt_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.receipt_patch.stop)
        records = {}
        for name in [p for files in source_assets.TARGETS.values() for p in files]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'\0asm\1\0\0\0' if name.endswith('.wasm') else b'export {};')
            records[name] = source_assets.file_record(name)
        self.receipt.write_text(json.dumps({'source_identity': source_assets.identity(), 'assets': records}))

    def verify(self):
        with patch.object(sys, 'argv', ['source-assets.py', 'verify']), contextlib.redirect_stdout(io.StringIO()):
            source_assets.main()

    def test_complete_receipt_verifies(self):
        self.verify()

    def test_pins_or_patch_edits_make_existing_build_stale(self):
        for name in ['pins.json', 'patches/prover/source.patch']:
            target = self.root / name
            original = target.read_bytes()
            target.write_bytes(original + b'\n')
            with self.assertRaisesRegex(ValueError, 'stale'):
                self.verify()
            target.write_bytes(original)

    def test_modified_module_or_bindings_are_rejected(self):
        for name in ['web/sequencer-prover.wasm', 'web/auth/browser_virtual_os.js']:
            target = self.root / name
            original = target.read_bytes()
            target.write_bytes(original + b'changed')
            with self.assertRaisesRegex(ValueError, 'differs'):
                self.verify()
            target.write_bytes(original)

    def test_missing_prover_receipt_is_rejected(self):
        data = json.loads(self.receipt.read_text())
        del data['assets']['web/sequencer-prover.wasm']
        self.receipt.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
