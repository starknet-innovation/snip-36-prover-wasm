"""Fetch pinned source trees and apply reviewed browser portability patches once."""
from pathlib import Path
import json,subprocess,sys,tarfile,hashlib,shutil,argparse
from executor_manifests import check_manifests, patch_fingerprint
from prover_sources import fingerprint, check_receipt, write_receipt, require_pristine, PROVER_PROFILES
root=Path(__file__).resolve().parents[1];build=root/'build';pins=json.loads((root/'pins.json').read_text())
def run(*args):subprocess.run(args,check=True)
def clone(name,url,rev):
 p=build/name
 if not (p/'.git').exists():
  p.mkdir(parents=True,exist_ok=True);run('git','-C',str(p),'init');run('git','-C',str(p),'remote','add','origin',url);run('git','-C',str(p),'fetch','--depth=1','origin',rev);run('git','-C',str(p),'checkout','--detach','FETCH_HEAD')
 actual=subprocess.check_output(['git','-C',str(p),'rev-parse','HEAD'],text=True).strip()
 assert actual==rev,f'Unexpected revision in {name}';return p
def apply(p,patch):
 if subprocess.run(['git','-C',str(p),'apply','--reverse','--check',str(patch)],capture_output=True).returncode==0:return
 run('git','-C',str(p),'apply','--check',str(patch));run('git','-C',str(p),'apply',str(patch))
parser=argparse.ArgumentParser(description=__doc__)
available_modes=['prover','prover-baseline','native','executor']
if (root/'patches/prover/candidate-workspace.patch').is_file():available_modes.append('prover-memory')
for profile in ['tradeoffs','kernels']:
 if (root/'patches/prover'/f'{profile}.patch').is_file():available_modes.append(f'prover-{profile}')
parser.add_argument('mode',choices=available_modes)
parser.add_argument('--build-dir',default='build',help='Fresh preparation directory under build/')
args=parser.parse_args();mode=args.mode
build=(root/args.build_dir).resolve()
if not build.is_relative_to(root/'build'):raise SystemExit('Preparation directory must be under build/')
if mode in PROVER_PROFILES:
 build=build/PROVER_PROFILES[mode]
 memory_profile=mode not in ('prover','prover-baseline')
 trees={}
 for name,repo,key in [('stwo','stwo','stwo'),('stwo-cairo','stwo-cairo','stwo_cairo'),('proving-utils','proving-utils','transaction_service_proving_utils')]:
  trees[name]=clone(name,f'https://github.com/starkware-libs/{repo}.git',pins[key])
 patches={name:root/'patches/prover'/f'{name}.patch' for name in trees}
 patches['pins']=root/'pins.json'
 if memory_profile:
  trees['stwo-circuits']=clone('stwo-circuits','https://github.com/starkware-libs/stwo-circuits.git',pins['stwo_circuits'])
  patches['workspace']=root/'patches/prover/candidate-workspace.patch'
  patches['lock']=root/'patches/prover/candidate.Cargo.lock'
  patches['stwo-circuits']=root/'patches/prover/stwo-circuits.patch'
  patches['lifetimes']=root/'patches/prover/lifetimes.patch'
  patches['striped']=root/'patches/prover/striped.patch'
  for layer in ['sourced-stwo','sourced-circuits','sourced-utils']:patches[layer]=root/'patches/prover'/f'{layer}.patch'
  patches['circuit-lock']=root/'patches/prover/circuits.Cargo.lock'
  if mode=='prover-tradeoffs':patches['tradeoffs']=root/'patches/prover/tradeoffs.patch'
  if mode=='prover-kernels':patches['kernels']=root/'patches/prover/kernels.patch'
 marker=build/'proving-utils/.wasm-patches-complete';patch_digest=fingerprint(patches)
 if check_receipt(marker,patch_digest,trees):
  print('Prover source already prepared');raise SystemExit(0)
 require_pristine(trees)
 for name,p in trees.items():
  if name in patches:apply(p,patches[name])
 if memory_profile:
  apply(build/'proving-utils',root/'patches/prover/candidate-workspace.patch')
  apply(build/'proving-utils',patches['lifetimes'])
  apply(build/'stwo',patches['striped'])
  for layer,name in [('sourced-stwo','stwo'),('sourced-circuits','stwo-circuits'),('sourced-utils','proving-utils')]:apply(build/name,patches[layer])
  (build/'stwo-circuits/Cargo.lock').write_bytes(patches['circuit-lock'].read_bytes())
  if 'tradeoffs' in patches:apply(build/'stwo',patches['tradeoffs'])
  if 'kernels' in patches:apply(build/'stwo',patches['kernels'])
  (build/'proving-utils/Cargo.lock').write_bytes((root/'patches/prover/candidate.Cargo.lock').read_bytes())
 write_receipt(marker,patch_digest,trees)
elif mode=='native':
 p=clone('native-prover','https://github.com/starkware-libs/proving-utils.git',pins['transaction_service_proving_utils'])
 # Only the lock and example below may differ from the pin; anything else is a local verifier edit.
 status=subprocess.check_output(['git','-C',str(p),'status','--porcelain','--untracked-files=all'],text=True).splitlines()
 unexpected=[l for l in status if l not in (' M Cargo.lock','?? crates/privacy_prove/examples/spike_native.rs')]
 if unexpected:raise SystemExit('Native verifier source is not pristine: '+', '.join(unexpected))
 (p/'Cargo.lock').write_bytes((root/'patches/prover/native.Cargo.lock').read_bytes());(p/'crates/privacy_prove/examples').mkdir(exist_ok=True)
 (p/'crates/privacy_prove/examples/spike_native.rs').write_bytes((root/'native/spike_native.rs').read_bytes())
elif mode=='executor':
 p=clone('sequencer','https://github.com/starkware-libs/sequencer.git',pins['sequencer']);marker=p/'.wasm-patches-complete'
 fingerprint=patch_fingerprint(root/'patches/executor')
 if marker.exists():
  assert marker.read_text()==fingerprint,'Executor patch set changed; use a fresh build/sequencer'
  check_manifests(p)
  assert (p/'Cargo.lock').read_bytes()==(root/'patches/executor/Cargo.lock').read_bytes(),'Prepared executor lock differs'
  print('Executor source already prepared');raise SystemExit(0)
 for name in ['sequencer.patch','program-compression.patch','signed-account-fixture.patch','partial-state-cache.patch','execution-capacity.patch']:apply(p,root/'patches/executor'/name)
 with tarfile.open(root/'patches/executor/cairo-classes-portable.tar.gz') as archive:archive.extractall(p,filter='data')
 apply(p,root/'patches/executor/public-state.patch')
 # Check the portability patches' original lock before applying reviewed security updates.
 assert hashlib.sha256((p/'Cargo.lock').read_bytes()).hexdigest()=='da9fb55917ef1c4cba51050c0cc7e4ee9a4a9fe8c18bfad4b77d6720ec67dcb4','Executor base lock differs'
 # This repository supports the browser executor, not the upstream sequencer node/bindings.
 apply(p,root/'patches/executor/dependency-scope.patch')
 shutil.copytree(root/'patches/executor/browser-vendor/num-prime-0.4.4',p/'browser-vendor/num-prime-0.4.4',dirs_exist_ok=True)
 # Dependabot resolves this same patched workspace; manifest edits need matching source patches.
 check_manifests(p)
 (p/'Cargo.lock').write_bytes((root/'patches/executor/Cargo.lock').read_bytes());marker.write_text(fingerprint)
else:raise SystemExit('Unsupported preparation mode')
