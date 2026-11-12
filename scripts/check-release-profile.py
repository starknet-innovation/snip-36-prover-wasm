"""Gate release downloads on the committed source and binary identities."""
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("source_assets", ROOT / "scripts/source-assets.py")
source_assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_assets)


def verify(root=ROOT):
    manifest = json.loads((root / "assets.json").read_text())
    release = manifest.get("release", "")
    if manifest.get("release_status") != "published" or not re.fullmatch(r"v\d+\.\d+\.\d+", release):
        raise ValueError("Release downloads require a published, validated release")
    evidence = json.loads((root / "evidence" / f"release-{release}.json").read_text())
    source_assets.ROOT = root
    if evidence.get("release") != release or evidence.get("source_identity") != source_assets.identity():
        raise ValueError("Release source profile differs from current pins or patches; build both modules with scripts/build.sh or validate a new release")
    records = {a["path"]: {k: a[k] for k in ["path", "bytes", "sha256"]} for a in manifest["assets"]}
    if len(records) != len(manifest["assets"]) or records != evidence.get("modules"):
        raise ValueError("Release module identities differ from validation evidence")
    print("Verified published release source profile and module identities:", release)


if __name__ == "__main__":
    verify()
