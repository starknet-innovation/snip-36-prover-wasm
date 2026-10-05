import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';
const manifest=JSON.parse(await readFile('assets.json'));const sha=b=>createHash('sha256').update(b).digest('hex');
for(const asset of manifest.assets){
 let data;try{data=await readFile(asset.path);}catch{}
 if(data?.length===asset.bytes&&sha(data)===asset.sha256){console.log('Verified '+asset.path);continue;}
 const response=await fetch(`https://github.com/${manifest.repository}/releases/download/${manifest.release}/${asset.name}`);if(!response.ok)throw Error(`Download ${asset.name}: HTTP ${response.status}`);
 data=Buffer.from(await response.arrayBuffer());if(data.length!==asset.bytes||sha(data)!==asset.sha256)throw Error('Release checksum mismatch: '+asset.name);
 await mkdir(path.dirname(asset.path),{recursive:true});await writeFile(asset.path+'.download',data);await rename(asset.path+'.download',asset.path);console.log('Downloaded and verified '+asset.path);
}
