import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prover_sources import fingerprint, check_receipt, write_receipt, require_pristine

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

    def test_first_receipt_requires_pristine_pin(self):
        with tempfile.TemporaryDirectory() as temporary:
            tree = Path(temporary)
            subprocess.run(['git', 'init', '-q', str(tree)], check=True)
            source = tree / 'lib.rs'; source.write_text('pinned')
            subprocess.run(['git', '-C', str(tree), 'add', 'lib.rs'], check=True)
            subprocess.run(['git', '-C', str(tree), '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'pin'], check=True)
            require_pristine({'test': tree})
            for file, content in [(source, 'unrelated edit'), (tree / 'new.rs', 'untracked')]:
                file.write_text(content)
                with self.assertRaisesRegex(RuntimeError, 'Unreceipted.*dirty'):
                    require_pristine({'test': tree})
                if file == source: source.write_text('pinned')
                else: file.unlink()
