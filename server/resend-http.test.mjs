import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Webhook} from 'svix';
import {DatabaseSync} from 'node:sqlite';

test('actual inbound HTTP server persists, retries, survives restart and retains observation during ingestion failure', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bustrackr-resend-'));
  const socket=createServer();
  await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  const secret=`whsec_${randomBytes(32).toString('base64')}`;
  const recipient='camera@example.com', webhookUrl='https://example.com/api/resend/inbound';
  const ids=['91736436-87f9-42c1-a422-ef7fc7b7d2e6','91736436-87f9-42c1-a422-ef7fc7b7d2e7'];
  const mail={from:'Avigilonalerts@vcs.net',to:[recipient],subject:'Camera alert',created_at:'2026-10-16T21:07:00Z',text:'[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.',html:null,authentication:{dkim:'pass',dmarc:'pass'}};
  const flag=join(dir,'fetch-fails');
  await writeFile(flag,'no');
  const preload=join(dir,'mock-resend.mjs');
  await writeFile(preload, `import {readFile} from 'node:fs/promises';
    globalThis.fetch=async input=>{
      const url=new URL(input);
      if(url.origin!=='https://api.resend.com')throw new Error('Unexpected external request');
      if(url.pathname==='/webhooks/test-hook')return new Response(JSON.stringify(${JSON.stringify({status:'enabled',endpoint:webhookUrl,events:['email.received'],signing_secret:secret})}));
      if((await readFile(${JSON.stringify(flag)},'utf8'))==='yes')return new Response('',{status:503});
      const id=url.pathname.split('/').at(-1);
      return new Response(JSON.stringify({...${JSON.stringify(mail)},id,message_id:'<'+id+'@example.com>'}));
    };`);
  const origin=`http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child=spawn(process.execPath,['--import',preload,'server/index.mjs'],{stdio:'pipe',env:{...process.env,
      RESEND_API_KEY:'test-only',RESEND_WEBHOOK_SECRET:secret,RESEND_WEBHOOK_ID:'test-hook',RESEND_WEBHOOK_URL:webhookUrl,
      RESEND_INBOUND_ADDRESS:recipient,RESEND_HEALTH_SECONDS:'5',CAMERA_SENDER:mail.from,CAMERA_MARKER:'BEI Bus has arrived.',
      ALERT_PORT:String(port),ALERT_HOST:'127.0.0.1',ALERT_STATE_FILE:join(dir,'state.json'),
    }});
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null)throw new Error('Receiver exited');
      try {const data=await (await fetch(`${origin}/api/shuttle`)).json();if(data.status==='connected')return data;}catch{}
      await delay(50);
    }
    throw new Error('Receiver did not start');
  }
  async function stop() {
    if(child && child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}
  }
  async function deliver(id, valid=true) {
    const raw=JSON.stringify({type:'email.received',data:{email_id:id,to:[recipient]}}), time=new Date();
    return fetch(`${origin}/api/resend/inbound`,{method:'POST',body:raw,headers:{
      'svix-id':'msg-test','svix-timestamp':String(Math.floor(time.getTime()/1000)),
      'svix-signature':valid?new Webhook(secret).sign('msg-test',time,raw):'invalid',
    }});
  }
  try {
    assert.equal((await start()).eventCount,0);
    assert.equal((await deliver(ids[0],false)).status,400);
    assert.equal((await deliver(ids[0])).status,200);
    const first=await (await fetch(`${origin}/api/shuttle`)).json();
    assert.equal(first.eventCount,1);assert.equal(first.latest.eventAt,'2026-10-16T21:06:43.000Z');
    assert.equal(first.prediction.status,'unconfigured');
    await writeFile(flag,'yes');
    assert.equal((await deliver(ids[1])).status,503);
    const failed=await (await fetch(`${origin}/api/shuttle`)).json();
    assert.equal(failed.status,'disconnected');assert.equal(failed.prediction.marker,null);assert.deepEqual(failed.latest,first.latest);
    await writeFile(flag,'no');assert.equal((await deliver(ids[1])).status,200);
    await stop();
    assert.equal((await start()).eventCount,2);
    assert.equal((await deliver(ids[0])).status,200);
    const db=new DatabaseSync(join(dir,'state.sqlite'),{readOnly:true});
    const rows=db.prepare('SELECT * FROM sightings ORDER BY seq').all();
    assert.equal(rows.length,2);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,2);
    assert.equal(rows[0].parser,'camera-email-v1');assert.match(rows[0].collector_source,/^[a-f0-9]{16}$/);
    assert.match(rows[0].body_sha256,/^[a-f0-9]{64}$/);
    db.close();
  } finally {await stop();await rm(dir,{recursive:true,force:true});}
});
