import {createHash, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {z} from 'zod';
import webPush from 'web-push';
import {saveState} from './alerts.mjs';
import {boundedText} from './resend.mjs';

const lifetime = 120_000;
const uuid = z.string().uuid();
const credentials = z.object({id:uuid, secret:uuid});
const encoded = size => z.string().regex(/^[A-Za-z0-9_-]+$/).refine(value => Buffer.from(value,'base64url').length === size);
function trustedEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname) ||
       url.hostname.endsWith('.notify.windows.com'));
  } catch {return false;}
}
const targetSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('expo'), token:z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{16,200}\]$/)}),
  z.object({kind:z.literal('web'), endpoint:z.string().max(2000).refine(trustedEndpoint), keys:z.object({p256dh:encoded(65),auth:encoded(16)})}),
]);
const registration = credentials.extend({target:targetSchema});
const digest = value => createHash('sha256').update(value).digest('hex');
const owns = (subscription, secret) => timingSafeEqual(Buffer.from(subscription.secretHash,'hex'),Buffer.from(digest(secret),'hex'));
const identity = target => target.kind === 'web' ? target.endpoint : target.token;
function failure(message, status=400) {return Object.assign(new Error(message),{status});}

export async function createNotificationService({path, events, send, receipt, config, now=Date.now}) {
  let state;
  try {state=JSON.parse(await readFile(path,'utf8'));}
  catch(error) {if(error.code!=='ENOENT')throw error;state={subscriptions:[],deliveries:[]};}
  if (!Array.isArray(state.subscriptions) || !Array.isArray(state.deliveries)) throw new Error('Invalid notification state');
  let queue=Promise.resolve();
  function serialize(work) {const result=queue.then(work);queue=result.catch(()=>{});return result;}
  async function commit(next) {await saveState(path,next);state=next;}
  let activeTick=null;
  async function runTick() {
    const {pending,waiting}=await serialize(async()=>{
      const time=now(),next=structuredClone(state);
      next.deliveries=next.deliveries.filter(d=>time-d.createdAt<86_400_000);
      const keys=new Set(next.deliveries.map(d=>d.id));
      for(const event of events()) {
        const eventTime=Date.parse(event.eventAt),received=Date.parse(event.receivedAt);
        if(event.duplicateOf || event.source!=='camera-email' || !event.id || !Number.isFinite(eventTime) ||
           !Number.isFinite(received) || eventTime>time || received>time || time-eventTime>lifetime || time-received>lifetime)continue;
        for(const subscription of next.subscriptions) {
          if(eventTime<=subscription.createdAt || received<=subscription.createdAt)continue;
          const id=`${event.id}:${subscription.id}`;
          if(keys.has(id))continue;
          next.deliveries.push({id,eventId:event.id,subscriptionId:subscription.id,eventAt:event.eventAt,
            createdAt:time,expiresAt:Math.min(eventTime,received)+lifetime,status:'queued',attempts:0,nextAttemptAt:time});
          keys.add(id);
        }
      }
      for(const delivery of next.deliveries) {
        if(delivery.status==='sending')delivery.status='queued';
        if(delivery.status==='queued' && delivery.expiresAt<=time)delivery.status='expired';
      }
      const pending=[];
      for(const delivery of next.deliveries.filter(d=>d.status==='queued' && d.nextAttemptAt<=time).slice(0,10)) {
        const subscription=next.subscriptions.find(s=>s.id===delivery.subscriptionId);
        if(!subscription){delivery.status='cancelled';continue;}
        delivery.status='sending';delivery.attempts++;
        pending.push({...delivery,target:subscription.target});
      }
      const waiting=receipt?next.deliveries.filter(d=>d.status==='accepted' && d.ticketId && d.nextReceiptAt<=time).slice(0,100):[];
      for(const delivery of waiting)delivery.nextReceiptAt=time+60_000;
      await commit(next);
      return {pending,waiting};
    });
    const results=await Promise.all(pending.map(async delivery=>{
      if(delivery.expiresAt<=now())return {id:delivery.id,status:'expired'};
      try {
        const result=await send(delivery.target,{eventId:delivery.eventId,eventAt:delivery.eventAt,
          title:'Fehren bus detected',body:'A Fehren bus was just detected at the camera checkpoint.'});
        return {id:delivery.id,status:'accepted',ticketId:result?.ticketId};
      }catch(error){return {id:delivery.id,status:error.permanent?'failed':'queued',deadTarget:!!error.deadTarget};}
    }));
    if(results.length)await serialize(async()=>{
      const updated=structuredClone(state);
      for(const result of results) {
        const delivery=updated.deliveries.find(d=>d.id===result.id);
        if(!delivery || !updated.subscriptions.some(s=>s.id===delivery.subscriptionId))continue;
        delivery.status=result.status;
        delivery.nextAttemptAt=now()+Math.min(60_000,5000*2**Math.min(delivery.attempts,4));
        if(delivery.attempts>=5 && delivery.status==='queued')delivery.status='failed';
        if(result.ticketId){delivery.ticketId=result.ticketId;delivery.nextReceiptAt=now()+60_000;}
        if(result.deadTarget)updated.subscriptions=updated.subscriptions.filter(s=>s.id!==delivery.subscriptionId);
      }
      await commit(updated);
    });
    if(waiting.length) {
      let receipts;
      try {receipts=await receipt(waiting.map(d=>d.ticketId));}catch {return;}
      await serialize(async()=>{
        const updated=structuredClone(state);
        for(const item of waiting) {
          const delivery=updated.deliveries.find(d=>d.id===item.id),result=receipts[item.ticketId];
          if(!delivery || !updated.subscriptions.some(s=>s.id===delivery.subscriptionId))continue;
          delivery.nextReceiptAt=now()+900_000;
          if(!result)continue;
          delivery.status=result.status==='ok'?'provider-accepted':'failed';
          if(result.details?.error==='DeviceNotRegistered')updated.subscriptions=updated.subscriptions.filter(s=>s.id!==delivery.subscriptionId);
        }
        await commit(updated);
      });
    }
  }
  return {
    publicConfig:()=>({...config}),
    async register(input) {
      const parsed=registration.safeParse(input);
      if(!parsed.success)throw failure('Invalid notification subscription');
      const {id,secret,target}=parsed.data;
      if(target.kind==='expo'?!config.expo:!config.webPushPublicKey)throw failure('Notifications are not configured for this device',503);
      return serialize(async()=>{
        const next=structuredClone(state), existing=next.subscriptions.find(s=>s.id===id);
        if(existing && !owns(existing,secret))throw failure('Subscription credentials do not match',403);
        if(next.subscriptions.some(s=>s.id!==id && identity(s.target)===identity(target)))throw failure('Device is already registered',409);
        if(!existing && next.subscriptions.length>=1000)throw failure('Notification registration is at capacity',503);
        if(existing)existing.target=target;
        else next.subscriptions.push({id,secretHash:digest(secret),target,createdAt:now()});
        await commit(next);
        return {ok:true};
      });
    },
    async remove(input) {
      const parsed=credentials.safeParse(input);
      if(!parsed.success)throw failure('Invalid notification subscription');
      return serialize(async()=>{
        const {id,secret}=parsed.data,existing=state.subscriptions.find(s=>s.id===id);
        if(existing && !owns(existing,secret))throw failure('Subscription credentials do not match',403);
        const next=structuredClone(state);
        next.subscriptions=next.subscriptions.filter(s=>s.id!==id);
        next.deliveries=next.deliveries.filter(d=>d.subscriptionId!==id);
        await commit(next);
        return {ok:true};
      });
    },
    tick() {
      if(!activeTick)activeTick=runTick().finally(()=>{activeTick=null;});
      return activeTick;
    },
    drain:async()=>{await activeTick;await queue;},
  };
}

export function notificationDelivery(env=process.env, fetchImpl=fetch) {
  const expo=env.NOTIFICATIONS_EXPO_ENABLED==='true';
  let webPushPublicKey=null;
  if(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
    try {webPush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);webPushPublicKey=env.VAPID_PUBLIC_KEY;}catch {}
  }
  const appUrl=env.NOTIFICATIONS_APP_URL || 'https://Valley-Christian-Startup-Incubator.github.io/BusTrackr/';
  async function expoRequest(path,body) {
    const response=await fetchImpl(`https://exp.host/--/api/v2/push/${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json',...(env.EXPO_ACCESS_TOKEN?{Authorization:`Bearer ${env.EXPO_ACCESS_TOKEN}`}:{})},body:JSON.stringify(body)});
    if(!response.ok)throw failure('Push service unavailable',503);
    return JSON.parse(await boundedText(response.body,256_000));
  }
  return {
    config:{webPushPublicKey,expo},
    async send(target,message) {
      if(target.kind==='expo') {
        if(!expo)throw failure('Expo push disabled',503);
        const result=await expoRequest('send',{to:target.token,title:message.title,body:message.body,
          data:{eventId:message.eventId,eventAt:message.eventAt},sound:'default',channelId:'bus-detections',ttl:120,collapseId:message.eventId});
        const ticket=Array.isArray(result.data)?result.data[0]:result.data;
        if(ticket?.status!=='ok' || typeof ticket.id!=='string')throw Object.assign(new Error('Expo rejected notification'),{
          permanent:['DeviceNotRegistered','MessageTooBig','InvalidCredentials'].includes(ticket?.details?.error),deadTarget:ticket?.details?.error==='DeviceNotRegistered'});
        return {ticketId:ticket.id};
      }
      if(!webPushPublicKey)throw failure('Web push disabled',503);
      try {await webPush.sendNotification({endpoint:target.endpoint,keys:target.keys},JSON.stringify({...message,url:appUrl}),{TTL:120,timeout:5000});}
      catch(error){throw Object.assign(new Error('Web push failed'),{permanent:error.statusCode>=400 && error.statusCode<500 && error.statusCode!==429,deadTarget:[404,410].includes(error.statusCode)});}
      return {};
    },
    async receipt(ids) {return (await expoRequest('getReceipts',{ids})).data || {};},
  };
}

export function notificationRoutes(service,{allowedOrigins=[],now=Date.now}={}) {
  const requests=new Map();
  return async(req,res)=>{
    if(!req.url.startsWith('/api/notifications/'))return false;
    const respond=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));return true;};
    if(req.headers.origin && !allowedOrigins.includes(req.headers.origin))return respond(403,{error:'Origin is not allowed'});
    if(req.method==='OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type');
      return respond(204,null);
    }
    if(req.method==='GET' && req.url==='/api/notifications/config')return respond(200,service.publicConfig());
    if(!['POST','DELETE'].includes(req.method) || req.url!=='/api/notifications/subscriptions')return respond(404,{error:'Not found'});
    const remote=req.socket.remoteAddress || 'unknown';
    const forwarded=req.headers['cf-connecting-ip'];
    const ip=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote) && typeof forwarded==='string' && isIP(forwarded)?forwarded:remote;
    const time=now();
    for(const [key,value] of requests)if(value.reset<=time)requests.delete(key);
    const limit=requests.get(ip) || {count:0,reset:time+60_000};
    if(requests.size>=2000 && !requests.has(ip) || ++limit.count>20)return respond(429,{error:'Try again later'});
    requests.set(ip,limit);
    if(!req.headers['content-type']?.startsWith('application/json'))return respond(415,{error:'Use application/json'});
    let input;
    try {input=JSON.parse(await boundedText(req,8000));}
    catch {return respond(400,{error:'Invalid notification request'});}
    try {return respond(200,await (req.method==='POST'?service.register(input):service.remove(input)));}
    catch(error){return respond(error.status || 503,{error:error.status?error.message:'Notification storage unavailable'});}
  };
}
