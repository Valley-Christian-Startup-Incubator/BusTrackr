import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {Webhook} from 'svix';
import {createReceiver,boundedText} from './resend.mjs';
import {openHistory} from './history.mjs';
import {createNotificationService,notificationRoutes} from './notifications.mjs';

test('a signed inbound email reaches durable camera history and one background notification',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'bustrackr-push-http-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let now=Date.parse('2026-11-02T23:00:00Z');
  const history=openHistory(join(dir,'camera.sqlite')),state=history.state,sent=[],secret=`whsec_${randomBytes(32).toString('base64')}`;
  const config={sender:'avigilonalerts@vcs.net',marker:'BEI Bus has arrived.',checkpoint:'BEI',recipient:'camera@example.com',webhookSecret:secret,cooldownSeconds:30};
  const receiver=createReceiver({history,config,api:async()=>({
    id:'91736436-87f9-42c1-a422-ef7fc7b7d2e6',from:config.sender,to:[config.recipient],subject:'Camera',
    created_at:'2026-11-02T23:00:02Z',text:'[2026-Nov-02 03:00:02 PM (PST)] BEI Bus has arrived.',html:null,authentication:{dkim:'pass',dmarc:'pass'},
  })});
  const options={path:join(dir,'notifications.json'),events:()=>state.events,config:{expo:true,webPushPublicKey:null},now:()=>now,
    send:async(target,message)=>{sent.push({target,message});return {};}};
  const notifications=await createNotificationService(options),routes=notificationRoutes(notifications);
  const server=createServer(async(req,res)=>{
    if(await routes(req,res))return;
    const result=await receiver.handle(await boundedText(req,64_000),req.headers);
    res.writeHead(result.status);res.end(JSON.stringify(result.body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const subscription={id:randomUUID(),secret:randomUUID(),target:{kind:'expo',token:'ExpoPushToken[abcdefghijklmnop]'}};
  assert.equal((await fetch(`${origin}/api/notifications/subscriptions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)})).status,200);
  now+=2000;
  const raw=JSON.stringify({type:'email.received',data:{email_id:'91736436-87f9-42c1-a422-ef7fc7b7d2e6',to:[config.recipient]}}),time=new Date();
  const headers={'svix-id':'msg-camera','svix-timestamp':String(Math.floor(time.getTime()/1000)),'svix-signature':new Webhook(secret).sign('msg-camera',time,raw)};
  assert.equal((await fetch(`${origin}/api/resend/inbound`,{method:'POST',headers,body:raw})).status,200);
  await notifications.tick();
  assert.equal(state.events.length,1);assert.equal(sent.length,1);
  assert.equal(sent[0].message.eventId,state.events[0].id);
  assert.equal(sent[0].message.eventAt,'2026-11-02T23:00:02.000Z');
  await fetch(`${origin}/api/resend/inbound`,{method:'POST',headers,body:raw});
  const restarted=await createNotificationService(options);await restarted.tick();
  assert.equal(sent.length,1);assert.equal(state.events.length,1);
});
