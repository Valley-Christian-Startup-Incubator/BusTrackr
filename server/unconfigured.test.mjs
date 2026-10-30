import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('unconfigured production worker serves health, hides estimates and rejects ingestion',async()=>{
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const dir=await mkdtemp(join(tmpdir(),'bustrackr-config-'));
 const env={...process.env,ALERT_PORT:String(port),ALERT_HOST:'127.0.0.1',ALERT_STATE_FILE:join(dir,'state.json')};
 for(const name of ['RESEND_API_KEY','RESEND_WEBHOOK_SECRET','RESEND_WEBHOOK_ID','RESEND_WEBHOOK_URL','RESEND_INBOUND_ADDRESS','CAMERA_SENDER','CAMERA_MARKER']) delete env[name];
 const child=spawn(process.execPath,['server/index.mjs'],{env,stdio:'ignore'});
 try {
  let health;
  for(let n=0;n<50;n++) {try {health=await fetch(`http://127.0.0.1:${port}/api/health`);break;}catch{await delay(50);}}
  assert(health);assert.equal((await health.json()).status,'needs_configuration');
  const feed=await (await fetch(`http://127.0.0.1:${port}/api/shuttle`)).json();assert.equal(feed.status,'disconnected');assert.equal(feed.prediction.marker,null);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/resend/inbound`,{method:'POST',body:'{}'})).status,503);
 } finally {child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});
