import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {mkdtemp,mkdir,writeFile,symlink,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFrontend} from './frontend.mjs';

const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;};
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
function rawGet(port,path) {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));
    });req.on('error',reject);req.end();
  });
}
test('frontend serves map assets safely and forwards signed API bytes through release changes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bustrackr-frontend-'));
  const old=join(dir,'old'),next=join(dir,'next'),live=join(dir,'website');
  for(const root of [old,next]) {
    await mkdir(join(root,'BusTrackr/assets'),{recursive:true});
    await writeFile(join(root,'index.html'),root===old?'old release':'new release');
    await writeFile(join(root,'BusTrackr/index.html'),'<div id="root"></div>');
    await writeFile(join(root,'BusTrackr/assets/index-ABCDEf12.js'),'retained script');
    await writeFile(join(root,'style.0123456789abcdef.css'),'body{}');
    await writeFile(join(root,'BusTrackr/data.json'),'{"ok":true}');
    await writeFile(join(root,'BusTrackr/bus.glb'),Buffer.from([0,1,2,3]));
    await writeFile(join(root,'BusTrackr/manifest.webmanifest'),'{}');
    await writeFile(join(root,'.env'),'private-secret');
    await writeFile(join(root,'private.md'),'private-secret');
    await symlink('/etc/hosts',join(root,'escape.html'));
  }
  await symlink(old,live);
  let finishSlow;
  const slowStarted=new Promise(resolve=>{
    finishSlow={started:resolve};
  });
  const upstream=createServer((req,res)=>{
    if(req.url==='/api/slow?x=1') {
      res.writeHead(200,{'Content-Type':'text/plain'});res.write('before-');
      finishSlow.end=()=>res.end('after');finishSlow.started();return;
    }
    const chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>{
      res.writeHead(202,{'Content-Type':'application/json'});
      res.end(JSON.stringify({method:req.method,url:req.url,signature:req.headers['svix-signature'],body:Buffer.concat(chunks).toString('base64')}));
    });
  });
  const upstreamPort=await listen(upstream);
  const frontend=createFrontend({root:live,upstreamPort});const port=await listen(frontend),base=`http://127.0.0.1:${port}`;
  try {
    assert.equal(await (await fetch(base)).text(),'old release');
    const slow=fetch(base+'/api/slow?x=1').then(response=>response.text());
    await slowStarted;
    await symlink(next,join(dir,'promote'));await rename(join(dir,'promote'),live);
    assert.equal(await (await fetch(base)).text(),'new release');
    finishSlow.end();assert.equal(await slow,'before-after');
    const postBody=Buffer.from('{ "type": "email.received", "raw": "\u00e9" }\n');
    const api=await fetch(base+'/api/resend/inbound?preserve=yes',{method:'POST',headers:{'svix-signature':'v1,signed-bytes'},body:postBody});
    assert.equal(api.status,202);
    assert.deepEqual(await api.json(),{method:'POST',url:'/api/resend/inbound?preserve=yes',signature:'v1,signed-bytes',body:postBody.toString('base64')});
    for(const [path,mime] of [['data.json','application/json'],['bus.glb','model/gltf-binary'],['manifest.webmanifest','application/manifest+json']]) {
      const response=await fetch(base+'/BusTrackr/'+path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),mime);
    }
    const map=await fetch(base+'/BusTrackr/?utm_source=instagram');assert.equal(map.status,200);assert.equal(map.headers.get('cache-control'),'no-store');
    const redirect=await fetch(base+'/BusTrackr?utm_source=instagram',{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/BusTrackr/?utm_source=instagram');
    const head=await fetch(base+'/BusTrackr/data.json',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    for(const path of ['/style.0123456789abcdef.css','/BusTrackr/assets/index-ABCDEf12.js'])assert.match((await fetch(base+path)).headers.get('cache-control'),/immutable/);
    for(const path of ['/.env','/%2eenv','/%2e%2e/private.md','/BusTrackr/%2e%2e/%2eenv','/%252eenv','/escape.html','/private.md','/BusTrackr%5c..%5c.env'])assert.equal((await rawGet(port,path)).status,404,path);
    assert.equal((await fetch(base,{method:'POST'})).status,404);
    await symlink(old,join(dir,'rollback'));await rename(join(dir,'rollback'),live);
    assert.equal(await (await fetch(base)).text(),'old release');
    assert.equal((await fetch(base+'/BusTrackr/assets/index-ABCDEf12.js')).status,200);
    await close(upstream);
    const unavailable=await fetch(base+'/api/health');assert.equal(unavailable.status,503);assert.equal(await unavailable.text(),'Service temporarily unavailable');
  } finally {await close(frontend);if(upstream.listening)await close(upstream);await rm(dir,{recursive:true,force:true});}
});
