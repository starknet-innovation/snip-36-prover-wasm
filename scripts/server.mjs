import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
export async function startServer(port=8767){
 const root=path.resolve('web');
 const server=http.createServer(async(req,res)=>{
  try{if(req.method!=='GET')throw Error();let file=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(file==='/')file='/index.html';file=path.resolve(root,'.'+file);if(!file.startsWith(root+path.sep))throw Error();const body=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'text/javascript','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await startServer();console.log('http://127.0.0.1:8767');}
