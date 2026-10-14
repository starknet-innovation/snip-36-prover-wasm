"""Exercise build selection/install behavior without compiling or downloading modules."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class ProverProfiles(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'scripts').mkdir(); (self.root / 'web').mkdir()
        for name in ['build.sh', 'prover_sources.py']:
            shutil.copy2(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        (self.root / 'scripts/prepare-sources.py').write_text('import sys\n')
        bins = self.root / 'bin'; bins.mkdir()
        (bins / 'python3').symlink_to(sys.executable)
        (bins / 'rustup').write_text('#!/bin/sh\nexit 0\n')
        (bins / 'cargo').write_text(f'#!{sys.executable}\n' + '''import json, os, sys
from pathlib import Path
args = sys.argv[1:]
manifest = args[args.index('--manifest-path') + 1]
profile = Path(manifest).parts[1]
root = Path(os.environ['CARGO_TARGET_DIR'])
file = root / 'wasm64-unknown-unknown/release/snip36_browser_prover.wasm'
file.parent.mkdir(parents=True, exist_ok=True)
file.write_bytes((profile + '-module').encode())
Path('cargo-call.json').write_text(json.dumps({'manifest': manifest, 'target': str(root), 'args': args,
    'rustflags': os.environ.get('CARGO_ENCODED_RUSTFLAGS', '').split('\\x1f')}))
''')
        for name in ['cargo', 'rustup']: (bins / name).chmod(0o755)
        self.env = {k:v for k,v in os.environ.items() if k != 'STARKNET_PRIVATE_KEY'}
        self.env.update(PATH=str(bins) + os.pathsep + os.environ['PATH'], WASM_CC='test-clang', WASM_AR='test-ar')
        self.installed = self.root / 'web/sequencer-prover.wasm'
        self.installed.write_bytes(b'released-default')

    def run_build(self, *args):
        return subprocess.run(['bash', str(self.root / 'scripts/build.sh'), *args], cwd=self.root,
                              env=self.env, capture_output=True, text=True)

    def test_default_build_selects_only_baseline_and_installs_it(self):
        result = self.run_build('prover'); self.assertEqual(result.returncode, 0, result.stderr)
        call = json.loads((self.root / 'cargo-call.json').read_text())
        self.assertEqual(call['manifest'], 'build/baseline/proving-utils/Cargo.toml')
        self.assertEqual(self.installed.read_bytes(), b'baseline-module')
        self.assertIn('--no-default-features', call['args'])
        self.assertIn('--locked', call['args'])
        self.assertIn('target-feature=+simd128', call['rustflags'])
        self.assertIn(f'--remap-path-prefix={self.root}=/src', call['rustflags'])
        self.assertTrue(any(flag.startswith('--remap-path-prefix=') and flag.endswith('=/cargo') for flag in call['rustflags']))

    def test_memory_is_separate_and_does_not_install_without_opt_in(self):
        result = self.run_build('prover-memory'); self.assertEqual(result.returncode, 0, result.stderr)
        call = json.loads((self.root / 'cargo-call.json').read_text())
        self.assertEqual(call['manifest'], 'build/memory/proving-utils/Cargo.toml')
        self.assertEqual(self.installed.read_bytes(), b'released-default')
        digest = hashlib.sha256(b'memory-module').hexdigest()
        self.assertEqual((self.root / f'build/wasm/{digest}.wasm').read_bytes(), b'memory-module')
        result = self.run_build('prover-memory', '--install'); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.installed.read_bytes(), b'memory-module')
        self.assertEqual(self.run_build('prover').returncode, 0)
        self.assertEqual(self.installed.read_bytes(), b'baseline-module')

    def test_experimental_profiles_and_baseline_control_do_not_install(self):
        for mode in ['prover-baseline', 'prover-tradeoffs', 'prover-kernels']:
            result = self.run_build(mode); self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.installed.read_bytes(), b'released-default')

    def test_invalid_install_flags_fail_before_compiling(self):
        for args in [('native', '--install'), ('prover-memory', '--unknown'), ('prover', '--install', 'extra')]:
            self.assertEqual(self.run_build(*args).returncode, 2)
            self.assertFalse((self.root / 'cargo-call.json').exists())
            self.assertEqual(self.installed.read_bytes(), b'released-default')
