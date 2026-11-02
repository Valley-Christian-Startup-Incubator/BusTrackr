import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createNotificationService,notificationRoutes,notificationDelivery} from './notifications.mjs';

const token='ExpoPushToken[abcdefghijklmnop]';
const input=()=>({id:randomUUID(),secret:randomUUID(),target:{kind:'expo',token}});
async function harness(t,{send,receipt}={}) {
  const dir=await mkdtemp(join(tmpdir(),'bustrackr-push-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'notifications.json'),events=[],sent=[];
  let time=Date.parse('2026-11-02T23:00:00Z');
  const options={path,events:()=>events,config:{expo:true,webPushPublicKey:'configured'},now:()=>time,
    send:send || (async(target,message)=>{sent.push({target,message});return {};}),receipt};
  const service=await createNotificationService(options);
  return {path,service,events,sent,options,advance:ms=>{time+=ms;},event:(id='camera-1',age=0,extra={})=>({id,source:'camera-email',eventAt:new Date(time-age).toISOString(),receivedAt:new Date(time-age).toISOString(),...extra})};
}
test('opt-in accepts only future fresh unique detections and survives retry and restart',async t=>{
  const h=await harness(t),subscription=input();
  h.events.push(h.event('before-registration'));
  await h.service.register(subscription);
  h.advance(1000);
  await h.service.register(subscription);
  h.events.push(h.event());
  h.events.push(h.event('grouped',0,{duplicateOf:'camera-1'}));
  h.events.push(h.event('old',121_000));
  h.events.push(h.event('future',-1000));
  await h.service.tick();await h.service.tick();
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].message.eventId,'camera-1');
  const restarted=await createNotificationService(h.options);
  await restarted.tick();assert.equal(h.sent.length,1);
  const state=JSON.parse(await readFile(h.path,'utf8'));
  assert.equal(state.deliveries.length,1);
  assert.equal(state.subscriptions[0].secret,undefined);
  assert.equal(state.subscriptions[0].secretHash.length,64);
});
test('subscription ownership protects update and unsubscribe; removal is idempotent',async t=>{
  const h=await harness(t),subscription=input();
  await h.service.register(subscription);
  await assert.rejects(h.service.register({...subscription,secret:randomUUID()}),e=>e.status===403);
  await assert.rejects(h.service.remove({...subscription,secret:randomUUID()}),e=>e.status===403);
  await assert.rejects(h.service.register(input()),e=>e.status===409);
  await h.service.remove(subscription);await h.service.remove(subscription);
  h.advance(1000);h.events.push(h.event());await h.service.tick();assert.equal(h.sent.length,0);
});
test('retryable outage resumes from disk and expired jobs do not send',async t=>{
  let fails=true,calls=0;
  const h=await harness(t,{send:async()=>{calls++;if(fails)throw new Error('network');return {};}});
  await h.service.register(input());h.advance(1000);h.events.push(h.event());
  await h.service.tick();assert.equal(calls,1);
  const restarted=await createNotificationService(h.options);
  h.advance(11_000);fails=false;await restarted.tick();assert.equal(calls,2);
  await restarted.tick();assert.equal(calls,2);
  fails=true;h.advance(1000);h.events.push(h.event('camera-2'));await restarted.tick();
  assert.equal(calls,3);h.advance(121_000);fails=false;await restarted.tick();assert.equal(calls,3);
});
test('dead providers remove subscriptions and Expo receipts clear unregistered devices',async t=>{
  const h=await harness(t,{send:async()=>({ticketId:'ticket-1'}),receipt:async()=>({'ticket-1':{status:'error',details:{error:'DeviceNotRegistered'}}})});
  await h.service.register(input());h.advance(1000);h.events.push(h.event());await h.service.tick();
  h.advance(61_000);await h.service.tick();
  assert.equal(JSON.parse(await readFile(h.path,'utf8')).subscriptions.length,0);
  const dead=await harness(t,{send:async()=>{throw Object.assign(new Error('gone'),{permanent:true,deadTarget:true});}});
  await dead.service.register(input());dead.advance(1000);dead.events.push(dead.event());await dead.service.tick();
  assert.equal(JSON.parse(await readFile(dead.path,'utf8')).subscriptions.length,0);
});
test('untrusted push endpoints, invalid keys and disabled transports cannot register',async t=>{
  const h=await harness(t),subscription=input();
  const keys={p256dh:Buffer.alloc(65).toString('base64url'),auth:Buffer.alloc(16).toString('base64url')};
  for(const endpoint of ['https://127.0.0.1/push','http://fcm.googleapis.com/push','https://fcm.googleapis.com.evil.test/push','https://fcm.googleapis.com:444/push','https://user@fcm.googleapis.com/push']) {
    await assert.rejects(h.service.register({...subscription,target:{kind:'web',endpoint,keys}}),e=>e.status===400);
  }
  await assert.rejects(h.service.register({...subscription,target:{kind:'web',endpoint:'https://fcm.googleapis.com/push',keys:{...keys,auth:'bad'}}}),e=>e.status===400);
  const disabled=await createNotificationService({...h.options,config:{expo:false,webPushPublicKey:null}});
  await assert.rejects(disabled.register(subscription),e=>e.status===503);
});
test('HTTP registration enforces origin, content type, body bounds and management secret',async t=>{
  const h=await harness(t),route=notificationRoutes(h.service,{allowedOrigins:['https://app.example']}),server=createServer(async(req,res)=>{await route(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/notifications`,subscription=input();
  assert.deepEqual(await (await fetch(`${base}/config`)).json(),{expo:true,webPushPublicKey:'configured'});
  assert.equal((await fetch(`${base}/subscriptions`,{method:'POST',body:JSON.stringify(subscription),headers:{Origin:'https://evil.example','Content-Type':'application/json'}})).status,403);
  assert.equal((await fetch(`${base}/subscriptions`,{method:'POST',body:'x'})).status,415);
  assert.equal((await fetch(`${base}/subscriptions`,{method:'POST',body:'x'.repeat(9000),headers:{'Content-Type':'application/json'}})).status,400);
  assert.equal((await fetch(`${base}/subscriptions`,{method:'OPTIONS',headers:{Origin:'https://app.example'}})).status,204);
  assert.equal((await fetch(`${base}/subscriptions`,{method:'POST',body:JSON.stringify(subscription),headers:{'Content-Type':'application/json'}})).status,200);
  assert.equal((await fetch(`${base}/subscriptions`,{method:'DELETE',body:JSON.stringify({...subscription,secret:randomUUID()}),headers:{'Content-Type':'application/json'}})).status,403);
});
test('Expo delivery stays on fixed API origin and returns ticket identities',async()=>{
  const calls=[],delivery=notificationDelivery({NOTIFICATIONS_EXPO_ENABLED:'true'},async(url,options)=>{
    calls.push({url,options});return Response.json({data:{status:'ok',id:'ticket-1'}});
  });
  assert.deepEqual(await delivery.send({kind:'expo',token},{title:'Bus',body:'Seen',eventId:'event',eventAt:'2026-11-02T23:00:00Z'}),{ticketId:'ticket-1'});
  assert.equal(calls[0].url,'https://exp.host/--/api/v2/push/send');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(JSON.parse(calls[0].options.body).collapseId,'event');
});
test('unsubscribe completes while delivery is in flight and finalization never resurrects it',async t=>{
  let finish,started;
  const sending=new Promise(resolve=>{started=resolve;});
  const pending=new Promise(resolve=>{finish=resolve;});
  const h=await harness(t,{send:async()=>{started();await pending;return {};}}),subscription=input();
  await h.service.register(subscription);h.advance(1000);h.events.push(h.event());
  const tick=h.service.tick();
  await sending;
  assert.equal(h.service.tick(),tick);
  await h.service.remove(subscription);
  let persisted=JSON.parse(await readFile(h.path,'utf8'));
  assert.equal(persisted.subscriptions.length,0);assert.equal(persisted.deliveries.length,0);
  finish();await tick;
  persisted=JSON.parse(await readFile(h.path,'utf8'));
  assert.equal(persisted.subscriptions.length,0);assert.equal(persisted.deliveries.length,0);
});
