import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prover_sources import fingerprint, check_receipt, write_receipt

class PreparationReceipts(unittest.TestCase):
    def test_rejects_changed_patches_sources_and_new_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); tree = root / 'source'; tree.mkdir()
            source = tree / 'lib.rs'; source.write_text('original')
            patch = root / 'patch'; patch.write_text('patch')
            marker = tree / '.wasm-patches-complete'
            files = {'patch': patch}; trees = {'source': tree}
            identity = fingerprint(files)
            self.assertFalse(check_receipt(marker, identity, trees))
            write_receipt(marker, identity, trees)
            self.assertTrue(check_receipt(marker, identity, trees))
            source.write_text('edited')
            with self.assertRaisesRegex(RuntimeError, 'sources changed'):
                check_receipt(marker, identity, trees)
            source.write_text('original')
            (tree / 'new.rs').write_text('untracked implementation')
            with self.assertRaisesRegex(RuntimeError, 'sources changed'):
                check_receipt(marker, identity, trees)
            (tree / 'new.rs').unlink(); patch.write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'patch set changed'):
                check_receipt(marker, fingerprint(files), trees)
