"""Compare resolved candidate identities, edges and features to the baseline."""
import json
import sys
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    'stwo': 'stwo/crates/stwo',
    'stwo-constraint-framework': 'stwo/crates/constraint-framework',
    'stwo-air-utils': 'stwo/crates/air-utils',
    'stwo-air-utils-derive': 'stwo/crates/air-utils-derive',
    'circuit-cairo-verifier': 'stwo-circuits/crates/cairo_verifier',
    'circuit-common': 'stwo-circuits/crates/circuit_common',
    'circuit-prover': 'stwo-circuits/crates/circuit_prover',
    'circuit-serialize': 'stwo-circuits/crates/circuit_serialize',
    'circuit-verifier': 'stwo-circuits/crates/circuit_verifier',
    'circuits': 'stwo-circuits/crates/circuits',
    'circuits-stark-verifier': 'stwo-circuits/crates/stark_verifier',
}

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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('metadata', nargs=3)
    parser.add_argument('--candidate-root', type=Path, default=ROOT / 'build/memory')
    args = parser.parse_args()
    baseline, candidate, native = [json.loads(Path(p).read_text()) for p in args.metadata]
    assert graph(baseline) == graph(candidate), 'Candidate changes dependency versions, edges or features'
    baseline_sources = {(p['name'], p['version']): p['source'] for p in baseline['packages']}
    for package in candidate['packages']:
        if package['name'] not in EXPECTED:
            assert baseline_sources[(package['name'], package['version'])] == package['source'], 'Unexpected source substitution'
    by_name = {p['name']: p for p in candidate['packages']}
    for name, folder in EXPECTED.items():
        package = by_name[name]
        assert package['source'] is None, f'{name} still resolves from Cargo Git cache'
        assert Path(package['manifest_path']).resolve() == args.candidate_root.resolve() / folder / 'Cargo.toml', name
    pins = json.loads((ROOT / 'pins.json').read_text())
    for package in native['packages']:
        for repository, key in [('stwo', 'stwo'), ('stwo-cairo', 'stwo_cairo'), ('stwo-circuits', 'stwo_circuits')]:
            source = package['source'] or ''
            if f'https://github.com/starkware-libs/{repository}?' in source:
                assert source.endswith('#' + pins[key]), 'Native verifier pin changed'
        if package['name'] in EXPECTED:
            assert package['source'] is not None, 'Native verifier received candidate overrides'
    print(json.dumps({'candidate_packages_resolve_locally': True, 'versions_edges_features_match_baseline': True,
                      'native_verifier_uses_pristine_git_dependencies': True}, indent=2))
