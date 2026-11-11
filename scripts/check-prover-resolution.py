"""Validate pinned V2 browser/native packages and inspect dependency graphs."""
import json
import re
import sys
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def from_repository(source, repository):
    """Cargo Git sources may use ?rev=, #sha only, or a .git suffix."""
    return re.search(rf'github\.com/starkware-libs/{re.escape(repository)}(\.git)?([?#]|$)', source) is not None


def graph(metadata):
    packages = {p['id']: (p['name'], p['version']) for p in metadata['packages']}
    nodes = []
    for node in metadata['resolve']['nodes']:
        edges = []
        for dep in node['deps']:
            kinds = sorted((k['kind'] or 'normal', k['target'] or '') for k in dep['dep_kinds'])
            edges.append((dep['name'], packages[dep['pkg']], kinds))
        nodes.append((packages[node['id']], sorted(node['features']), sorted(edges)))
    return sorted(nodes)

if __name__ == '__main__':
    import subprocess
    parser = argparse.ArgumentParser(description="Check browser and pristine native V2 cryptographic package identities")
    parser.add_argument('metadata', nargs=2)
    parser.add_argument('--browser-root', type=Path, default=ROOT / 'build/proving')
    parser.add_argument('--native-root', type=Path, default=ROOT / 'build/native-prover')
    args = parser.parse_args()
    pins = json.loads((ROOT / 'pins.json').read_text())
    core = {
        'privacy-prove': 'privacy_prove', 'privacy-circuit-verify': 'privacy_circuit_verify',
        'privacy_common': 'privacy_common', 'cairo-program-runner-lib': 'cairo-program-runner-lib',
        'stwo': 'stwo', 'stwo-cairo-prover': 'prover', 'cairo-air': 'cairo-air',
        'circuit-prover': 'circuit_prover', 'circuit-common': 'circuit_common',
        'circuit-cairo-verifier': 'cairo_verifier', 'circuit-verifier': 'circuit_verifier',
        'circuits': 'circuits', 'circuits-stark-verifier': 'stark_verifier',
    }
    versions = []
    for file, root in zip(args.metadata, [args.browser_root, args.native_root]):
        actual = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        if actual != pins['transaction_service_proving']:
            raise SystemExit('V2 source checkout revision differs from pins.json')
        document = json.loads(Path(file).read_text())
        found = {}
        for name, folder in core.items():
            matches = [p for p in document['packages'] if p['name'] == name]
            if len(matches) != 1:
                raise SystemExit('Missing or ambiguous V2 cryptographic package: ' + name)
            package = matches[0]
            if package['source'] is not None or Path(package['manifest_path']).resolve() != root.resolve() / 'crates' / folder / 'Cargo.toml':
                raise SystemExit('V2 package resolved outside the pinned checkout: ' + name)
            found[name] = package['version']
        versions.append(found)
    if versions[0] != versions[1]:
        raise SystemExit('Browser/native V2 cryptographic package versions differ')
    print(json.dumps({'pinned_v2_checkouts': True, 'crypto_package_paths_match': True,
                      'browser_native_crypto_versions_match': True, 'packages': versions[0]}, indent=2))
