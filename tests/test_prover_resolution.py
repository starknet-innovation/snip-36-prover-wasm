import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import importlib.util
spec = importlib.util.spec_from_file_location('resolution', Path(__file__).resolve().parents[1] / 'scripts/check-prover-resolution.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class ResolutionGraph(unittest.TestCase):
    def test_detects_feature_version_edge_and_target_drift(self):
        import copy
        baseline = {'packages': [{'id': 'one', 'name': 'one', 'version': '1'}, {'id': 'two', 'name': 'two', 'version': '1'}],
                    'resolve': {'nodes': [{'id': 'one', 'features': ['parallel'], 'deps': [{'name': 'two', 'pkg': 'two', 'dep_kinds': [{'kind': None, 'target': 'cfg(wasm)'}]}]},
                                          {'id': 'two', 'features': [], 'deps': []}]}}
        variants = []
        for change in ['feature', 'version', 'edge', 'target']:
            candidate = copy.deepcopy(baseline)
            if change == 'feature': candidate['resolve']['nodes'][0]['features'] = []
            if change == 'version': candidate['packages'][1]['version'] = '2'
            if change == 'edge': candidate['resolve']['nodes'][0]['deps'] = []
            if change == 'target': candidate['resolve']['nodes'][0]['deps'][0]['dep_kinds'][0]['target'] = None
            variants.append(candidate)
        for candidate in variants:
            self.assertNotEqual(module.graph(baseline), module.graph(candidate))
