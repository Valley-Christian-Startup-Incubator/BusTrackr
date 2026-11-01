import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {serveWebsite} from './website.mjs';
test('site serves HTML and HEAD while excluding private files and symlink escapes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bustrackr-site-'));await writeFile(join(root,'index.html'),'<h1>BusTrackr</h1>');await writeFile(join(root,'.env'),'secret');await symlink('/etc/hosts',join(root,'outside.html'));
 const server=createServer(async(req,res)=>{if(!await serveWebsite(req,res,root)){res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{assert.match(await(await fetch(base)).text(),/BusTrackr/);assert.equal((await fetch(base,{method:'HEAD'})).status,200);for(const path of ['/.env','/%2eenv','/outside.html','/missing.html'])assert.equal((await fetch(base+path)).status,404);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
