import importlib.util
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('identity', Path(__file__).resolve().parents[1] / 'scripts/prover-identity.py')
identity = importlib.util.module_from_spec(spec); spec.loader.exec_module(identity)
class SourceIdentity(unittest.TestCase):
    def test_missing_tree_is_not_an_empty_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(FileNotFoundError, 'Missing source tree'):
                identity.tree_digest(Path(temporary) / 'missing')

    def test_baseline_records_resolved_git_circuits_without_phantom_checkout(self):
        import json
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            names = ['stwo', 'stwo-cairo', 'proving-utils']
            for name in names: (root / 'build/baseline' / name).mkdir(parents=True)
            (root / 'build/native-prover').mkdir()
            receipt = root / 'build/baseline/proving-utils/.wasm-patches-complete'
            receipt.write_text(json.dumps({'trees': dict.fromkeys(names, 'digest')}))
            git_package = root / 'cargo-git-circuit'; git_package.mkdir()
            manifest = git_package / 'Cargo.toml'; manifest.write_text('[package]')
            (root / 'pins.json').write_text('{"rust":"nightly-2026-01-15"}')
            (root / 'patches/prover').mkdir(parents=True)
            wasm = root / 'module.wasm'; wasm.write_bytes(b'wasm')
            metadata = root / 'metadata.json'; metadata.write_text(json.dumps({'packages': [
                {'name': 'circuit-prover', 'version': '1', 'source': 'git+https://github.com/starkware-libs/stwo-circuits#pin', 'manifest_path': str(manifest)}]}))
            output = root / 'identity.json'
            with patch.object(identity, 'ROOT', root), patch.object(identity, 'command', return_value={'stdout':'', 'exit_code':0}), patch('sys.argv', ['identity', '--source-root', 'build/baseline', '--wasm', str(wasm), '--metadata', str(metadata), '--output', str(output)]):
                identity.main()
            report = json.loads(output.read_text())
            self.assertNotIn('stwo-circuits', report['source_trees'])
            self.assertEqual(report['resolved_git_circuit_packages'][0]['files_sha256'], identity.tree_digest(git_package))
