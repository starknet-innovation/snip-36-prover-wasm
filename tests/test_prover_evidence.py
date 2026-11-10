import contextlib
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).resolve().parents[1] / 'scripts/package-port-evidence.py')
evidence = importlib.util.module_from_spec(spec); spec.loader.exec_module(evidence)

def write_complete(raw):
    for relative in evidence.REQUIRED:
        file = raw / relative; file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b'{"failures": 0}' if relative.name == 'result.json' else b'evidence')


class EvidencePackaging(unittest.TestCase):
    def test_missing_empty_and_incomplete_roots_fail_before_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); raw = root / 'artifacts/port'
            output = root / 'new-parent/evidence.tar.gz'
            with patch.object(evidence, 'RAW', raw), patch.object(evidence, 'ROOT', root):
                for state in ['absent', 'empty', 'partial']:
                    if state != 'absent': raw.mkdir(parents=True, exist_ok=True)
                    if state == 'partial': (raw / 'unrelated.json').write_text('{}')
                    with self.assertRaisesRegex(ValueError, 'Missing'):
                        evidence.package(output)
                    self.assertFalse(output.parent.exists())

    def test_complete_bundle_preserves_members_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); raw = root / 'artifacts/port'; output = root / 'bundle.tar.gz'
            write_complete(raw)
            with patch.object(evidence, 'RAW', raw), patch.object(evidence, 'ROOT', root):
                first = raw / evidence.REQUIRED[0]; first.write_bytes(b'')
                with self.assertRaisesRegex(ValueError, 'Missing required'):
                    evidence.package(output)
                first.write_bytes(b'evidence')
                gettarinfo = tarfile.TarFile.gettarinfo
                def changing_log(archive, name, *args, **kwargs):
                    # Simulate a writer changing a log between snapshot and tar header creation.
                    Path(name).write_bytes(b'changed after snapshot')
                    return gettarinfo(archive, name, *args, **kwargs)
                with patch.object(tarfile.TarFile, 'gettarinfo', changing_log), contextlib.redirect_stdout(io.StringIO()):
                    evidence.package(output)
                index = json.loads(output.with_suffix('.gz.json').read_text())
                self.assertEqual(index['archive_sha256'], hashlib.sha256(output.read_bytes()).hexdigest())
                with tarfile.open(output) as archive:
                    self.assertEqual(len(archive.getmembers()), len(evidence.REQUIRED))
                    for member in index['files']:
                        data = archive.extractfile(member['path']).read()
                        self.assertEqual(member['sha256'], hashlib.sha256(data).hexdigest())
                original = output.read_bytes()
                with self.assertRaisesRegex(ValueError, 'new evidence'):
                    evidence.package(output)
                self.assertEqual(output.read_bytes(), original)

    def test_failed_boundaries_symlinks_and_errors_publish_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); raw = root / 'artifacts/port'; output = root / 'out/bundle.tar.gz'
            write_complete(raw)
            result = next(raw / p for p in evidence.REQUIRED if p.name == 'result.json')
            with patch.object(evidence, 'RAW', raw), patch.object(evidence, 'ROOT', root):
                result.write_text('{"failures": 2}')
                with self.assertRaisesRegex(ValueError, 'did not pass'):
                    evidence.package(output)
                result.write_text('{"failures": 0}')
                link = raw / 'link.log'; link.symlink_to(root / 'outside.log')
                with self.assertRaisesRegex(ValueError, 'symlinked'):
                    evidence.package(output)
                link.unlink()
                with patch.object(tarfile.TarFile, 'addfile', side_effect=OSError('disk full')):
                    with self.assertRaises(OSError):
                        evidence.package(output)
                self.assertEqual(sorted(p.name for p in output.parent.iterdir()), [])

    def test_home_paths_are_replaced_and_original_digest_kept(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); raw = root / 'artifacts/port'; output = root / 'bundle.tar.gz'
            write_complete(raw)
            original = b'{"path":"/Users/someone/strk/x","linux":"/home/someone/y"}'
            (raw / 'metadata.json').write_bytes(original)
            with patch.object(evidence, 'RAW', raw), patch.object(evidence, 'ROOT', root), contextlib.redirect_stdout(io.StringIO()):
                evidence.package(output)
            entry = next(f for f in json.loads(output.with_suffix('.gz.json').read_text())['files'] if f['path'].endswith('metadata.json'))
            self.assertEqual(entry['original_sha256'], hashlib.sha256(original).hexdigest())
            with tarfile.open(output) as archive:
                self.assertEqual(archive.extractfile(entry['path']).read(), b'{"path":"$HOME/strk/x","linux":"$HOME/y"}')
