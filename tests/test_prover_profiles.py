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
        (self.root / 'scripts/source-assets.py').write_text('import sys\n')
        bins = self.root / 'bin'; bins.mkdir()
        (bins / 'python3').symlink_to(sys.executable)
        (bins / 'rustup').write_text('#!/bin/sh\nexit 0\n')
        (bins / 'test-clang').write_text('#!/bin/sh\necho 23.1.5\n')
        (bins / 'test-clang').chmod(0o755)
        (bins / 'cargo').write_text(f'#!{sys.executable}\n' + '''import json, os, sys
from pathlib import Path
args = sys.argv[1:]
if 'install' in args:
    Path('host-install.json').write_text(json.dumps({'rustflags': os.environ.get('RUSTFLAGS'),
        'encoded_rustflags': os.environ.get('CARGO_ENCODED_RUSTFLAGS')}))
    sys.exit(0)
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

    def test_default_build_selects_v2_and_installs_it(self):
        result = self.run_build('prover'); self.assertEqual(result.returncode, 0, result.stderr)
        call = json.loads((self.root / 'cargo-call.json').read_text())
        self.assertEqual(call['manifest'], 'build/proving/Cargo.toml')
        self.assertEqual(self.installed.read_bytes(), b'proving-module')
        self.assertIn('--no-default-features', call['args'])
        self.assertIn('--locked', call['args'])
        self.assertIn('target-feature=+simd128', call['rustflags'])
        self.assertIn(f'--remap-path-prefix={self.root}=/src', call['rustflags'])
        self.assertTrue(any(flag.startswith('--remap-path-prefix=') and flag.endswith('=/cargo') for flag in call['rustflags']))

    def test_legacy_clang_fails_before_build_or_install(self):
        (self.root / 'bin/test-clang').write_text('#!/bin/sh\necho 18.1.3\n')
        result = self.run_build('prover')
        self.assertEqual(result.returncode, 2)
        self.assertIn('requires LLVM clang 21 or newer', result.stderr)
        self.assertFalse((self.root / 'cargo-call.json').exists())
        self.assertEqual(self.installed.read_bytes(), b'released-default')

    def test_v1_profiles_fail_before_compiling_or_installing(self):
        for mode in ['prover-memory', 'prover-tradeoffs', 'prover-kernels']:
            for flags in [[], ['--install']]:
                result = self.run_build(mode, *flags)
                self.assertEqual(result.returncode, 2)
                self.assertIn('unavailable for the V2 circuit', result.stderr)
                self.assertFalse((self.root / 'cargo-call.json').exists())
                self.assertEqual(self.installed.read_bytes(), b'released-default')

    def test_stock_v2_control_is_isolated_and_cannot_replace_optimized_default(self):
        result = self.run_build('prover-baseline')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.installed.read_bytes(), b'released-default')
        self.assertEqual(json.loads((self.root / 'cargo-call.json').read_text())['manifest'], 'build/proving-baseline/Cargo.toml')
        digest = hashlib.sha256(b'proving-baseline-module').hexdigest()
        self.assertEqual((self.root / f'build/wasm/{digest}.wasm').read_bytes(), b'proving-baseline-module')
        result = self.run_build('prover-baseline', '--install')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(self.installed.read_bytes(), b'released-default')

    def test_invalid_install_flags_fail_before_compiling(self):
        for args in [('native', '--install'), ('prover-memory', '--unknown'), ('prover', '--install', 'extra')]:
            self.assertEqual(self.run_build(*args).returncode, 2)
            self.assertFalse((self.root / 'cargo-call.json').exists())
            self.assertEqual(self.installed.read_bytes(), b'released-default')

    def test_executor_installs_native_bindgen_without_wasm_backend_flags(self):
        (self.root / 'scripts/prepare-compiler.py').write_text('pass\n')
        (self.root / 'scripts/check-compiler.py').write_text('pass\n')
        compiler = self.root / 'build/compiler-venv/bin'
        compiler.mkdir(parents=True)
        (compiler / 'python').symlink_to(sys.executable)
        (compiler / 'pip').write_text('#!/bin/sh\nexit 0\n')
        (compiler / 'pip').chmod(0o755)
        tool = self.root / 'build/tools/bin/wasm-bindgen'
        tool.parent.mkdir(parents=True)
        tool.write_text('#!/bin/sh\nexit 0\n')
        tool.chmod(0o755)
        self.env['RUSTFLAGS'] = '--cfg getrandom_backend="wasm_js"'
        result = self.run_build('executor')
        self.assertEqual(result.returncode, 0, result.stderr)
        install = json.loads((self.root / 'host-install.json').read_text())
        self.assertIsNone(install['rustflags'])
        self.assertIsNone(install['encoded_rustflags'])
