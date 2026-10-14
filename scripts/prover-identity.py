"""Record source/build identities without changing pins or release checksums."""
import argparse
import hashlib
import json
import os
import platform
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def digest(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
def command(*args):
    try:
        result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    except OSError as error:  # e.g. sysctl/pmset on Linux
        return {'exit_code': None, 'stdout': '', 'stderr': str(error)}
    return {'exit_code': result.returncode, 'stdout': result.stdout.strip(), 'stderr': result.stderr.strip()}

def tree_digest(directory):
    if not directory.is_dir():
        raise FileNotFoundError(f"Missing source tree: {directory}")
    result = hashlib.sha256()
    for file in sorted(directory.rglob('*')):
        relative = file.relative_to(directory)
        if '.git' in relative.parts or not file.is_file() or file.name.startswith('.wasm-patches'):
            continue
        result.update(str(relative).encode() + b'\0')
        result.update(hashlib.sha256(file.read_bytes()).digest())
    return result.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wasm', required=True, type=Path)
    parser.add_argument('--metadata', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source-root', default=Path('build/baseline'), type=Path)
    parser.add_argument('--clang', default=os.environ.get('WASM_CC', '/opt/homebrew/Cellar/llvm@21/21.1.8/bin/clang'))
    args = parser.parse_args()
    pins = json.loads((ROOT / 'pins.json').read_text())
    metadata = json.loads(args.metadata.read_text())
    source_directory = lambda name: (Path('build') if name == 'native-prover' else args.source_root) / name
    receipt = ROOT / args.source_root / 'proving-utils/.wasm-patches-complete'
    if not receipt.is_file():
        raise RuntimeError('Prepared source receipt required for identity')
    prepared = json.loads(receipt.read_text())
    tree_names = list(prepared['trees']) + ['native-prover']
    report = {
        'schema': 1, 'starting_sha': '739b084d1f533e60cd38cf9a0a6391de7965aafd',
        'target_head': command('git', 'rev-parse', 'HEAD'),
        'branch': command('git', 'branch', '--show-current'),
        'worktree': command('git', 'status', '--short'), 'pins': pins,
        'prepared_source_receipt': prepared,
        'patches': {str(p.relative_to(ROOT)): digest(p) for p in sorted((ROOT / 'patches/prover').rglob('*')) if p.is_file()},
        'wasm': {'path': str(args.wasm), **digest(args.wasm)},
        'metadata': digest(args.metadata),
        'resolved_packages': [{'name': p['name'], 'version': p['version'], 'source': p['source'], 'manifest_path': p['manifest_path']} for p in metadata['packages']],
        'resolved_git_circuit_packages': [{'name': p['name'], 'source': p['source'],
            'manifest_path': p['manifest_path'], 'files_sha256': tree_digest(Path(p['manifest_path']).parent)}
            for p in metadata['packages'] if p.get('source') and 'stwo-circuits' in p['source']],
        'resolved_features': metadata.get('resolve'),
        'source_trees': {name: {'files_sha256': tree_digest(ROOT / source_directory(name)),
                                'head': command('git', '-C', str(source_directory(name)), 'rev-parse', 'HEAD'),
                                'diff': command('git', '-C', str(source_directory(name)), 'diff', '--binary')}
                         for name in tree_names},
        'tools': {'rust': command('rustc', f"+{pins['rust']}", '-Vv'), 'node': command('node', '--version'),
                  'llvm': command(args.clang, '--version')},
        'host': {'platform': platform.platform(), 'machine': platform.machine(), 'ram': command('sysctl', '-n', 'hw.memsize'),
                 'power_policy': command('pmset', '-g')},
        'flags': 'RUSTFLAGS=--cfg getrandom_backend="custom" -C target-feature=+simd128; --locked --release --target wasm64-unknown-unknown -Z build-std=std,panic_abort --no-default-features; stack=8388608 max-memory=17179869184',
        'measurement_limit': 'Rust requested peak is cumulative per instance; excludes allocator overhead, JS and RSS. Linear memory never shrinks on free.'
    }
    # Keep a digest of the potentially large source diff instead of embedding vendor code.
    for tree in report['source_trees'].values():
        diff = tree['diff']['stdout'].encode()
        tree['diff'] = {'sha256': hashlib.sha256(diff).hexdigest(), 'bytes': len(diff)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as output:
        json.dump(report, output, indent=2)
        output.write('\n')

if __name__ == '__main__':
    main()
