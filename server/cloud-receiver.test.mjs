import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {Webhook} from 'svix';
import {BlobPreconditionFailedError} from '@vercel/blob';
import {createBlobState} from './blob-state.mjs';
import {receiveCloudEmail} from './cloud-receiver.mjs';
function storage() {
  let body = null, version = 0;
  return createBlobState({
    read:async()=>body === null ? null : {stream:new Response(body).body,blob:{etag:String(version)}},
    write:async(path, next, options)=>{
      if (body !== null && options.ifMatch !== String(version)) throw new BlobPreconditionFailedError();
      body = next; version++;
    },
  });
}
const config = {sender:'camera@example.com',marker:'BEI Bus has arrived.',checkpoint:'BEI',recipient:'inbound@example.com',webhookSecret:`whsec_${randomBytes(32).toString('base64')}`,cooldownSeconds:30};
function delivery(id) {
  const raw=JSON.stringify({type:'email.received',data:{email_id:id,to:[config.recipient]}}), time=new Date();
  return {raw,headers:{'svix-id':id,'svix-timestamp':String(Math.floor(time.getTime()/1000)),'svix-signature':new Webhook(config.webhookSecret).sign(id,time,raw)}};
}
const mail = id => ({id,from:config.sender,to:[config.recipient],subject:'Bus',created_at:'2026-10-16T21:07:00Z',text:'[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.',html:null,authentication:{dkim:'pass',dmarc:'pass'}});
test('cloud CAS preserves concurrent unique deliveries and deduplicates replays',async()=>{
  const store=storage(), ids=[randomUUID(),randomUUID(),randomUUID()];
  const api=async path=>mail(path.split('/')[3].split('?')[0]);
  const results=await Promise.all(ids.map(id=>receiveCloudEmail({...delivery(id),config,api,store})));
  assert(results.every(result=>result.status===200));
  const state=await store.read(); assert.equal(state.events.length,3); assert.equal(state.resendReceipts.length,3); assert.deepEqual(state.pending,[]);
  assert.equal((await receiveCloudEmail({...delivery(ids[0]),config,api:()=>{throw Error('must not fetch');},store})).body.duplicate,true);
});
test('cloud failed delivery stays pending across receiver instances until retry succeeds',async()=>{
  const store=storage(), id=randomUUID(), request={...delivery(id),config,store};
  assert.equal((await receiveCloudEmail({...request,api:async()=>{throw Error('offline');}})).status,503);
  assert.deepEqual((await store.read()).pending,[id]);
  assert.equal((await receiveCloudEmail({...request,api:async()=>mail(id)})).status,200);
  assert.deepEqual((await store.read()).pending,[]);
  assert.equal((await store.read()).events.length,1);
});
test('unsigned cloud request cannot read or write storage',async()=>{
  const result=await receiveCloudEmail({raw:'{}',headers:{},config,store:{update:()=>{throw Error('unexpected');}}});
  assert.equal(result.status,400);
});
