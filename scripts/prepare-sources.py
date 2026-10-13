"""Fetch pinned source trees and apply reviewed browser portability patches once."""
from pathlib import Path
import json,subprocess,sys,tarfile,hashlib,shutil,argparse
from executor_manifests import check_manifests, patch_fingerprint
from prover_sources import fingerprint, check_receipt, write_receipt
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
parser.add_argument('mode',choices=['prover','prover-baseline','prover-tradeoffs','prover-kernels','native','executor'])
parser.add_argument('--build-dir',default='build',help='Fresh preparation directory under build/')
args=parser.parse_args();mode=args.mode
build=(root/args.build_dir).resolve()
if not build.is_relative_to(root/'build'):raise SystemExit('Preparation directory must be under build/')
if mode in ('prover','prover-baseline','prover-tradeoffs','prover-kernels'):
 if mode=='prover-baseline':build=build/'baseline'
 if mode=='prover-tradeoffs':build=build/'tradeoffs'
 if mode=='prover-kernels':build=build/'kernels'
 trees={}
 for name,repo,key in [('stwo','stwo','stwo'),('stwo-cairo','stwo-cairo','stwo_cairo'),('proving-utils','proving-utils','transaction_service_proving_utils')]:
  trees[name]=clone(name,f'https://github.com/starkware-libs/{repo}.git',pins[key])
 patches={name:root/'patches/prover'/f'{name}.patch' for name in trees}
 patches['pins']=root/'pins.json'
 if mode!='prover-baseline':
  trees['stwo-circuits']=clone('stwo-circuits','https://github.com/starkware-libs/stwo-circuits.git',pins['stwo_circuits'])
  circuit_patch=root/'patches/prover/stwo-circuits.patch'
  if circuit_patch.exists():patches['stwo-circuits']=circuit_patch
  patches['workspace']=root/'patches/prover/candidate-workspace.patch'
  patches['lock']=root/'patches/prover/candidate.Cargo.lock'
  lifetime_patch=root/'patches/prover/lifetimes.patch'
  if lifetime_patch.exists():patches['lifetimes']=lifetime_patch
  striped_patch=root/'patches/prover/striped.patch'
  if striped_patch.exists():patches['striped']=striped_patch
  for layer in ['sourced-stwo','sourced-circuits','sourced-utils']:
   patch=root/'patches/prover'/f'{layer}.patch'
   if patch.exists():patches[layer]=patch
  circuit_lock=root/'patches/prover/circuits.Cargo.lock'
  if circuit_lock.exists():patches['circuit-lock']=circuit_lock
  if mode=='prover-tradeoffs':patches['tradeoffs']=root/'patches/prover/tradeoffs.patch'
  if mode=='prover-kernels':patches['kernels']=root/'patches/prover/kernels.patch'
 marker=build/'proving-utils/.wasm-patches-complete';patch_digest=fingerprint(patches)
 if check_receipt(marker,patch_digest,trees):
  print('Prover source already prepared');raise SystemExit(0)
 for name,p in trees.items():
  if name in patches:apply(p,patches[name])
 if mode!='prover-baseline':
  apply(build/'proving-utils',root/'patches/prover/candidate-workspace.patch')
  if 'lifetimes' in patches:apply(build/'proving-utils',patches['lifetimes'])
  if 'striped' in patches:apply(build/'stwo',patches['striped'])
  for layer,name in [('sourced-stwo','stwo'),('sourced-circuits','stwo-circuits'),('sourced-utils','proving-utils')]:
   if layer in patches:apply(build/name,patches[layer])
  if 'circuit-lock' in patches:(build/'stwo-circuits/Cargo.lock').write_bytes(patches['circuit-lock'].read_bytes())
  if 'tradeoffs' in patches:apply(build/'stwo',patches['tradeoffs'])
  if 'kernels' in patches:apply(build/'stwo',patches['kernels'])
  (build/'proving-utils/Cargo.lock').write_bytes((root/'patches/prover/candidate.Cargo.lock').read_bytes())
 write_receipt(marker,patch_digest,trees)
elif mode=='native':
 p=clone('native-prover','https://github.com/starkware-libs/proving-utils.git',pins['transaction_service_proving_utils'])
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
else:raise SystemExit('prover | prover-baseline | native | executor')
