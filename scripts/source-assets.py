"""Record or verify locally compiled modules without using released V1 binaries."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from executor_manifests import patch_fingerprint

ROOT = Path(__file__).resolve().parents[1]
RECEIPT = ROOT / 'build/source-assets.json'
TARGETS = {
    'executor': ['web/auth/browser_virtual_os_bg.wasm', 'web/auth/browser_virtual_os.js'],
    'prover': ['web/sequencer-prover.wasm'],
}


def identity():
    return {
        'pins_sha256': hashlib.sha256((ROOT / 'pins.json').read_bytes()).hexdigest(),
        'executor_patch_sha256': patch_fingerprint(ROOT / 'patches/executor'),
        'prover_patch_sha256': patch_fingerprint(ROOT / 'patches/prover'),
    }


def file_record(name):
    data = (ROOT / name).read_bytes()
    if name.endswith('.wasm') and data[:8] != b'\0asm\1\0\0\0':
        raise ValueError(f'Invalid Wasm module: {name}')
    return {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['executor', 'prover', 'verify'])
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    expected = identity()
    receipt = json.loads(RECEIPT.read_text()) if RECEIPT.exists() else {}
    if args.mode == 'verify':
        if receipt.get('source_identity') != expected:
            raise ValueError('Source assets are stale; rebuild both modules with scripts/build.sh')
        records = receipt.get('assets', {})
        for name in [name for names in TARGETS.values() for name in names]:
            if records.get(name) != file_record(name):
                raise ValueError(f'Source-built asset differs or is missing: {name}; rebuild it')
        print('Verified locally built V2 modules and executor bindings')
        return
    pins = json.loads((ROOT / 'pins.json').read_text())
    source = args.source or ROOT / 'build' / ('sequencer' if args.mode == 'executor' else 'proving')
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != pins['sequencer' if args.mode == 'executor' else 'transaction_service_proving']:
        raise ValueError('Source build revision differs from pins.json')
    marker = source / '.wasm-patches-complete'
    if marker.read_text() != expected[args.mode + '_patch_sha256']:
        raise ValueError('Source build patches differ from the prepared workspace')
    if receipt.get('source_identity') != expected:
        receipt = {'source_identity': expected, 'assets': {}}
    for name in TARGETS[args.mode]:
        receipt['assets'][name] = file_record(name)
    RECEIPT.parent.mkdir(exist_ok=True)
    RECEIPT.write_text(json.dumps(receipt, indent=2) + '\n')
    print('Recorded source-built ' + args.mode)


if __name__ == '__main__':
    main()
