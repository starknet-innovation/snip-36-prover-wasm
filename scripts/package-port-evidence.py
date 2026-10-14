"""Package public local validation journals; WASM/PIE and mutation binaries stay local."""
import argparse
import gzip
import hashlib
import json
import io
import os
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'artifacts/port'
WORKLOADS = ('balance', 'coinflip-heads', 'coinflip-tails')
REQUIRED = tuple(Path(p) for p in (
    'benchmark-02/registration.json', 'benchmark-02/attempts.json', 'benchmark-02/summary.json',
    'sourced-proof-05/attempt.json',
)) + tuple(Path(f'sourced-proof-05/{name}.{suffix}')
          for name in WORKLOADS for suffix in ('proof.bin', 'proof.json')) + tuple(
    Path(f'boundaries/{name}-01/{file}') for name in WORKLOADS
    for file in ('manifest.json', 'attempts.jsonl', 'result.json'))
# Local home directories are replaced in archived copies; the index keeps each
# member's original digest so hashes embedded elsewhere still verify.
HOME = re.compile(rb'/(?:Users|home)/[^/\s"\'`]+')


def scrub(data):
    return HOME.sub(b'$HOME', data)


def collect_evidence(raw):
    if not raw.is_dir():
        raise ValueError(f'Missing evidence root: {raw}')
    missing = [str(p) for p in REQUIRED if not (raw / p).is_file() or (raw / p).stat().st_size == 0]
    if missing:
        raise ValueError('Missing required evidence: ' + ', '.join(missing))
    failed = [str(p) for p in REQUIRED if p.name == 'result.json' and json.loads((raw / p).read_text()).get('failures') != 0]
    if failed:
        raise ValueError('Boundary checks did not pass: ' + ', '.join(failed))
    # Explicit public validation directory, never configuration or secret-manager paths.
    files = []
    for file in sorted(raw.rglob('*')):
        if file.is_symlink():
            raise ValueError(f'Refusing symlinked evidence: {file}')
        if not file.is_file():
            continue
        relative = file.relative_to(raw)
        if file.suffix in {'.json', '.jsonl', '.log', '.stdout', '.stderr'} or file.name.endswith('.sha256'):
            files.append(file)
        elif file.name in {'kernel-disassembly-03.txt', 'quotient-disassembly-03.txt', 'quotient-loop-disassembly-03.txt'}:
            files.append(file)
        elif relative.parts[0] == 'sourced-proof-05' and file.name.endswith('.proof.bin'):
            files.append(file)
    if not files:
        raise ValueError('No evidence selected')
    return files


def package(output_path):
    index = output_path.with_suffix(output_path.suffix + '.json')
    if output_path.exists() or index.exists():
        raise ValueError('Use a new evidence archive and index path')
    files = collect_evidence(RAW)
    manifest = []
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Write both files under temporary names; publish only when both are complete.
    partial = [output_path.with_name(output_path.name + '.partial'), index.with_name(index.name + '.partial')]
    try:
        with partial[0].open('xb') as output:
            with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode='w') as archive:
                    for file in files:
                        # One byte snapshot supplies both archived content and its identity.
                        original = file.read_bytes()
                        data = scrub(original)
                        info = archive.gettarinfo(str(file), arcname=str(file.relative_to(ROOT)))
                        info.size = len(data)
                        info.mtime = 0; info.uid = info.gid = 0; info.uname = info.gname = ''
                        archive.addfile(info, io.BytesIO(data))
                        entry = {'path': str(file.relative_to(ROOT)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                        if data != original:
                            entry['original_sha256'] = hashlib.sha256(original).hexdigest()
                        manifest.append(entry)
        with partial[1].open('x') as output:
            json.dump({'scope': 'Raw public validation journals, metadata, identities, logs, disassembly and three final proof binaries; large modules, PIE and mutation binaries retained locally',
                       'home_paths': 'replaced with $HOME; original_sha256 is the digest before replacement',
                       'archive_sha256': hashlib.sha256(partial[0].read_bytes()).hexdigest(), 'files': manifest}, output, indent=2)
            output.write('\n')
        for temporary, final in zip(partial, [output_path, index]):
            os.link(temporary, final)  # fails rather than overwrite
    finally:
        for temporary in partial:
            temporary.unlink(missing_ok=True)
    print(json.dumps({'archive': str(output_path), 'files': len(files), 'bytes': output_path.stat().st_size}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='New .tar.gz file')
    args = parser.parse_args()
    try:
        package(args.output)
    except ValueError as error:
        parser.exit(1, f'{error}\n')
