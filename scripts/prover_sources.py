"""Preparation receipts guard layered prover patches and reject stale edited trees."""
import hashlib
import json
import subprocess
from pathlib import Path


def fingerprint(files):
    state = hashlib.sha256()
    for name, file in sorted(files.items()):
        state.update(name.encode() + b'\0' + file.read_bytes())
    return state.hexdigest()


def source_digest(directory):
    state = hashlib.sha256()
    for file in sorted(directory.rglob('*')):
        relative = file.relative_to(directory)
        if '.git' in relative.parts or 'target' in relative.parts or file.name == '.wasm-patches-complete':
            continue
        if file.is_file():
            state.update(str(relative).encode() + b'\0')
            state.update(hashlib.sha256(file.read_bytes()).digest())
    return state.hexdigest()


def check_receipt(marker, patch_digest, trees):
    if not marker.exists():
        return False
    receipt = json.loads(marker.read_text())
    if receipt['patches_sha256'] != patch_digest:
        raise RuntimeError('Prover patch set changed; use fresh prepared source directories')
    actual = {name: source_digest(tree) for name, tree in trees.items()}
    if receipt['trees'] != actual:
        raise RuntimeError('Prepared prover sources changed; use fresh prepared source directories')
    return True


def write_receipt(marker, patch_digest, trees):
    marker.write_text(json.dumps({'patches_sha256': patch_digest,
                                 'trees': {name: source_digest(tree) for name, tree in trees.items()}}, indent=2) + '\n')


def require_pristine(trees):
    """First receipts must originate from pristine pins, never adopted dirty trees."""
    for name, tree in trees.items():
        status = subprocess.check_output(
            ['git', '-C', str(tree), 'status', '--porcelain', '--untracked-files=all', '--ignored'],
            text=True)
        if status:
            raise RuntimeError(f'Unreceipted {name} sources are dirty; use fresh prepared source directories')
