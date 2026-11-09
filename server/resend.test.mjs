import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {Webhook} from 'svix';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boundedText, checkReceiver, createReceiver, receivedAlert, resendApi} from './resend.mjs';
import {openHistory} from './history.mjs';

const secret = `whsec_${randomBytes(32).toString('base64')}`;
const config = {sender:'avigilonalerts@vcs.net', subject:'', marker:'BEI Bus has arrived.', checkpoint:'BEI campus corner', recipient:'camera@example.com', webhookSecret:secret, webhookId:'hook-test', webhookUrl:'https://example.com/api/resend/inbound', cooldownSeconds:30};
const emailId = '91736436-87f9-42c1-a422-ef7fc7b7d2e6';
const mail = {id:emailId, from:'Avigilonalerts@vcs.net', to:[config.recipient], subject:'Camera notification', created_at:'2026-10-16T21:07:00Z', message_id:'<camera-test@example.com>', text:'[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.', html:null, headers:{date:'Fri, 16 Oct 2026 14:07:00 -0700'}, authentication:{dkim:'pass', dmarc:'pass'}};
function signed(data = {type:'email.received',data:{email_id:emailId,to:[config.recipient]}}, time = new Date()) {
  const raw = JSON.stringify(data), id = 'msg-test', timestamp = String(Math.floor(time.getTime()/1000));
  return {raw, headers:{'svix-id':id, 'svix-timestamp':timestamp, 'svix-signature':new Webhook(secret).sign(id,time,raw)}};
}
function harness(overrides = {}) {
  const path = overrides.path ?? join(mkdtempSync(join(tmpdir(), 'bustrackr-receiver-')), 'history.sqlite');
  const history = overrides.history ?? openHistory(path); let calls=0;
  const receiver = createReceiver({history,config,api:async()=>{calls++; return mail;},...overrides});
  return {path,history,state:history.state,receiver,get calls(){return calls;}};
}
test('receiving email preserves camera, reported and received times and filters recipient/authentication/sender', async()=>{
  const alert = await receivedAlert(mail,config);
  assert.equal(alert.eventAt,'2026-10-16T21:06:43.000Z');
  assert.equal(alert.receivedAt,'2026-10-16T21:07:00.000Z');
  assert.equal(alert.reportedAt,'2026-10-16T21:07:00.000Z');
  assert.equal(alert.text,undefined);
  assert.equal((await receivedAlert({...mail,text:null,html:`<p>${mail.text}</p>`},config)).eventAt,alert.eventAt);
  for (const change of [{from:'other@example.com'},{to:['other@example.com']},{authentication:null},{authentication:{dkim:'fail',dmarc:'fail'}},{text:'Motion detected.'}]) assert.equal(await receivedAlert({...mail,...change},config),null);
});
test('rejects unsigned, tampered and old webhooks before any API call', async()=>{
  const h=harness(), event=signed();
  assert.equal((await h.receiver.handle(event.raw,{})).status,400);
  assert.equal((await h.receiver.handle(event.raw+' ',event.headers)).status,400);
  const old=signed(undefined,new Date(Date.now()-600_000));
  assert.equal((await h.receiver.handle(old.raw,old.headers)).status,400);
  assert.equal(h.calls,0);
});
test('concurrent duplicate deliveries persist once and stay idempotent after restart', async()=>{
  const h=harness(), event=signed();
  const results=await Promise.all(Array.from({length:5},()=>h.receiver.handle(event.raw,event.headers)));
  assert(results.every(result=>result.status===200)); assert.equal(h.calls,1); assert.equal(h.state.events.length,1);
  const restarted=harness({path:h.path,api:async()=>{throw new Error('Must not fetch duplicate');}});
  assert.equal((await restarted.receiver.handle(event.raw,event.headers)).status,200);
});
test('failed persistence returns a retryable status without committing in-memory state', async()=>{
  let fail=true;
  const history=openHistory(':memory:'), record=history.record;
  history.record=(...args)=>{if(fail)throw new Error('Disk unavailable');return record(...args);};
  const h=harness({history}), event=signed();
  assert.equal((await h.receiver.handle(event.raw,event.headers)).status,503);
  assert.equal(h.receiver.healthy,false); assert.equal(h.state.events.length,0);
  fail=false;
  assert.equal((await h.receiver.handle(event.raw,event.headers)).status,200);
  assert.equal(h.state.events.length,1); assert.equal(h.receiver.healthy,true);
});
test('ignores unrelated event types and recipients without fetching private email bodies', async()=>{
  const h=harness();
  for (const data of [{type:'email.sent'},{type:'email.received',data:{email_id:emailId,to:['unrelated@example.com']}}]) {
    const event=signed(data); assert.equal((await h.receiver.handle(event.raw,event.headers)).status,200);
  }
  assert.equal(h.calls,0);
});
test('retryable API failure hides feed health until the failed email succeeds', async()=>{
  let fail=true;
  const h=harness({api:async()=>{if(fail)throw new Error('Rate limited');return mail;}}), event=signed();
  assert.equal((await h.receiver.handle(event.raw,event.headers)).status,503);
  assert.equal(h.receiver.healthy,false); fail=false;
  assert.equal((await h.receiver.handle(event.raw,event.headers)).status,200); assert.equal(h.receiver.healthy,true);
});
test('health check requires enabled matching endpoint, subscription and signing secret', async()=>{
  const webhook={status:'enabled',endpoint:config.webhookUrl,events:['email.received'],signing_secret:secret};
  await checkReceiver(async()=>webhook,config);
  for(const change of [{status:'disabled'},{endpoint:'https://other.example.com'},{events:[]},{signing_secret:'different'}]) await assert.rejects(checkReceiver(async()=>({...webhook,...change}),config));
});
test('Resend API uses fixed origin, bearer authentication and bounded responses', async()=>{
  const api=resendApi('test-only',async(url,options)=>{
    assert.equal(url,`https://api.resend.com/emails/receiving/${emailId}`);
    assert.equal(options.headers.Authorization,'Bearer test-only'); assert.equal(options.redirect,'error');
    return new Response(JSON.stringify(mail));
  });
  assert.deepEqual(await api(`/emails/receiving/${emailId}`),mail);
  await assert.rejects(resendApi('test',async()=>new Response('x'.repeat(2_000_001)))('/test'));
});
test('signed HTTP delivery reaches camera history and rejects invalid authentication', async()=>{
  const h=harness(), event=signed();
  const server=createServer(async(req,res)=>{
    const result=await h.receiver.handle(await boundedText(req,64_000),req.headers);
    res.writeHead(result.status);res.end(JSON.stringify(result.body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/resend/inbound`;
  try {
    assert.equal((await fetch(url,{method:'POST',body:event.raw})).status,400);
    assert.equal((await fetch(url,{method:'POST',body:event.raw,headers:event.headers})).status,200);
    assert.equal(h.state.latest.eventAt,'2026-10-16T21:06:43.000Z');
    assert.equal(openHistory(h.path).state.events.length,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('accepts either configured receiving address and ignores others', async()=>{
  const both={...config,recipient:'fehren@inbound.valleychristianai.com, fehren2@inbound.valleychristianai.com'};
  for (const to of ['fehren@inbound.valleychristianai.com','fehren2@inbound.valleychristianai.com']) {
    assert(await receivedAlert({...mail,to:[to]},both));
    const h=harness({config:both,api:async()=>({...mail,to:[to]})});
    const event=signed({type:'email.received',data:{email_id:emailId,to:[to]}});
    assert.equal((await h.receiver.handle(event.raw,event.headers)).body.stored,true);
  }
  assert.equal(await receivedAlert({...mail,to:['other@inbound.valleychristianai.com']},both),null);
});
