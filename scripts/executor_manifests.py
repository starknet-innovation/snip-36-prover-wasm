"""Maintain and validate Dependabot's manifest-only executor workspace.

The Rust sources remain in the pinned, patched sequencer checkout. Dependabot
needs all its manifests to resolve the committed lock, but never builds them.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
MIRROR = ROOT / "patches/executor"


def all_manifests(tree):
    return {
        file.relative_to(tree).as_posix(): file.read_bytes()
        for file in sorted(tree.rglob("Cargo.toml"))
        if not {".git", "target"}.intersection(file.relative_to(tree).parts)
    }


def manifests(tree):
    """Follow the same workspace/path closure needed by Cargo and Dependabot."""
    queue = [tree / "Cargo.toml"]
    found = {}
    while queue:
        file = queue.pop().resolve()
        if not file.is_relative_to(tree.resolve()):
            raise ValueError(f"Manifest path escapes executor workspace: {file}")
        name = file.relative_to(tree.resolve()).as_posix()
        if name in found:
            continue
        content = file.read_bytes()
        found[name] = content
        document = tomllib.loads(content.decode())
        workspace = document.get("workspace", {})
        for pattern in workspace.get("members", []):
            queue.extend(member / "Cargo.toml" for member in file.parent.glob(pattern))
        tables = [document, workspace, *document.get("target", {}).values()]
        dependencies = []
        for table in tables:
            for kind in ("dependencies", "dev-dependencies", "build-dependencies"):
                dependencies.extend(table.get(kind, {}).values())
        dependencies.extend(document.get("replace", {}).values())
        for table in document.get("patch", {}).values():
            dependencies.extend(table.values())
        for dependency in dependencies:
            if isinstance(dependency, dict) and "path" in dependency:
                queue.append(file.parent / dependency["path"] / "Cargo.toml")
    return dict(sorted(found.items()))


def check_manifests(source, mirror=MIRROR):
    expected, actual = manifests(source), all_manifests(mirror)
    if "Cargo.toml" not in expected:
        raise ValueError(f"No executor workspace at {source}")
    missing = sorted(expected.keys() - actual.keys())
    extra = sorted(actual.keys() - expected.keys())
    changed = sorted(name for name in expected.keys() & actual.keys()
                     if expected[name] != actual[name])
    if missing or extra or changed:
        raise ValueError(
            "Executor manifest mirror differs from patched sources: "
            f"missing={missing}, extra={extra}, changed={changed}. "
            "Update the source patches and regenerate with "
            "python3 scripts/executor_manifests.py sync."
        )
    return expected


def patch_fingerprint(tree):
    digest = hashlib.sha256()
    for file in sorted(tree.rglob("*")):
        if file.is_file():
            digest.update(file.relative_to(tree).as_posix().encode() + b"\0")
            digest.update(hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


def sync(source):
    pins = json.loads((ROOT / "pins.json").read_text())
    revision = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    if revision != pins["sequencer"]:
        raise ValueError("Manifest source is not the pinned sequencer revision")
    files = manifests(source)
    if "Cargo.toml" not in files:
        raise ValueError("Manifest source has no workspace")
    for name in all_manifests(MIRROR).keys() - files.keys():
        (MIRROR / name).unlink()
    for name, content in files.items():
        target = MIRROR / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    print(f"Mirrored {len(files)} patched executor manifests")


def resolver_sources(manifest):
    """Cargo metadata needs targets, but never compiles these temporary files."""
    document = tomllib.loads(manifest.read_text())
    if "package" not in document:
        return
    paths = {"src/lib.rs", "src/main.rs"}
    for kind in ("lib", "bin", "test", "bench", "example"):
        entries = document.get(kind, [])
        if isinstance(entries, dict):
            entries = [entries]
        for entry in entries:
            name = entry.get("path")
            if name is None:
                folder = {"lib": "src", "bin": "src/bin", "test": "tests",
                          "bench": "benches", "example": "examples"}[kind]
                name = f"{folder}/{entry.get('name', 'lib')}.rs"
            paths.add(name)
    build = document["package"].get("build")
    if isinstance(build, str):
        paths.add(build)
    for name in paths:
        target = manifest.parent / name
        # Resolver placeholders must stay inside their own package.
        if not target.resolve().is_relative_to(manifest.parent.resolve()):
            raise ValueError(f"Target escapes resolver package: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("fn main() {}\n")


def metadata(tree):
    return json.loads(subprocess.check_output([
        "cargo", "+stable", "metadata", "--locked", "--format-version", "1",
        "--manifest-path", str(tree / "Cargo.toml"),
    ], cwd=tree, env={**os.environ, "RUSTC_WRAPPER": ""}))


def dependency_graph(document, tree):
    # Local package IDs contain checkout paths; all dependency identities,
    # edges, features and target conditions must otherwise match exactly.
    serialized = json.dumps({
        "workspace_members": document["workspace_members"],
        "resolve": document["resolve"],
    }, sort_keys=True).replace(tree.resolve().as_posix(), "<executor>")
    graph = json.loads(serialized)
    graph["workspace_members"].sort()
    graph["resolve"]["nodes"].sort(key=lambda node: node["id"])
    return graph


def resolve(source):
    files = check_manifests(source)
    lock = (MIRROR / "Cargo.lock").read_bytes()
    if (source / "Cargo.lock").read_bytes() != lock:
        raise ValueError("Prepared source lock differs from committed executor lock")
    with tempfile.TemporaryDirectory(prefix="executor-resolver-") as directory:
        tree = Path(directory).resolve()
        for name, content in files.items():
            target = tree / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            resolver_sources(target)
        shutil.copyfile(MIRROR / "Cargo.lock", tree / "Cargo.lock")
        if dependency_graph(metadata(tree), tree) != dependency_graph(metadata(source), source):
            raise ValueError("Mirror and prepared sources resolve different dependency graphs")
        if (tree / "Cargo.lock").read_bytes() != lock or (source / "Cargo.lock").read_bytes() != lock:
            raise ValueError("Cargo changed the reviewed lock")
    print(f"Validated {len(files)} manifests and identical locked dependency graphs")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["sync", "check", "resolve"])
    parser.add_argument("--source", type=Path, default=ROOT / "build/sequencer")
    args = parser.parse_args()
    source = args.source.resolve()
    if args.command == "sync":
        sync(source)
    elif args.command == "resolve":
        resolve(source)
    else:
        files = check_manifests(source)
        print(f"Validated {len(files)} patched executor manifests")


if __name__ == "__main__":
    main()
