"""Fetch pinned source trees and apply reviewed browser portability patches once."""
from pathlib import Path
import json,subprocess,sys,tarfile,hashlib
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
mode=sys.argv[1]
if mode=='prover':
 for name,repo,key in [('stwo','stwo','stwo'),('stwo-cairo','stwo-cairo','stwo_cairo'),('proving-utils','proving-utils','transaction_service_proving_utils')]:
  p=clone(name,f'https://github.com/starkware-libs/{repo}.git',pins[key]);apply(p,root/'patches/prover'/f'{name}.patch')
elif mode=='native':
 p=clone('native-prover','https://github.com/starkware-libs/proving-utils.git',pins['transaction_service_proving_utils'])
 (p/'Cargo.lock').write_bytes((root/'patches/prover/native.Cargo.lock').read_bytes());(p/'crates/privacy_prove/examples').mkdir(exist_ok=True)
 (p/'crates/privacy_prove/examples/spike_native.rs').write_bytes((root/'native/spike_native.rs').read_bytes())
elif mode=='executor':
 p=clone('sequencer','https://github.com/starkware-libs/sequencer.git',pins['sequencer']);marker=p/'.wasm-patches-complete'
 fingerprint=hashlib.sha256(b''.join(f.read_bytes() for f in sorted((root/'patches/executor').iterdir()) if f.is_file())).hexdigest()
 if marker.exists():
  assert marker.read_text()==fingerprint,'Executor patch set changed; use a fresh build/sequencer'
  print('Executor source already prepared');raise SystemExit(0)
 for name in ['sequencer.patch','program-compression.patch','signed-account-fixture.patch','partial-state-cache.patch','execution-capacity.patch']:apply(p,root/'patches/executor'/name)
 with tarfile.open(root/'patches/executor/cairo-classes-portable.tar.gz') as archive:archive.extractall(p,filter='data')
 apply(p,root/'patches/executor/public-state.patch')
 # Check the portability patches' original lock before applying reviewed security updates.
 assert hashlib.sha256((p/'Cargo.lock').read_bytes()).hexdigest()=='da9fb55917ef1c4cba51050c0cc7e4ee9a4a9fe8c18bfad4b77d6720ec67dcb4','Executor base lock differs'
 (p/'Cargo.lock').write_bytes((root/'patches/executor/Cargo.lock').read_bytes());marker.write_text(fingerprint)
else:raise SystemExit('prover | native | executor')
