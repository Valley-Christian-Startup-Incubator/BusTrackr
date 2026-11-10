import {serveWebsite} from './website.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {boundedText, checkReceiver, createReceiver, resendApi} from './resend.mjs';
import {PARSER, parseAlert} from './alerts.mjs';
import {collectorSource, openHistory} from './history.mjs';
import {dashboardSync, umamiSink} from './dashboard.mjs';
import {backtest, estimate, serviceDate} from './estimator.mjs';
import {createNotificationService, notificationDelivery, notificationRoutes} from './notifications.mjs';
import {createWaitlist, waitlistRoutes} from './waitlist.mjs';
import {createFeedbackLog, feedbackRoutes} from './feedback.mjs';
import {accountsPath, openAccounts, pilotSiteUrl, sessionRoutes} from './accounts.mjs';
import {createMailer} from './email.mjs';

const sample = process.argv.includes('--sample');
const once = process.argv.includes('--once');
const required = sample ? [] : ['RESEND_API_KEY','RESEND_WEBHOOK_SECRET','RESEND_WEBHOOK_ID','RESEND_WEBHOOK_URL','RESEND_INBOUND_ADDRESS','CAMERA_SENDER','CAMERA_MARKER'];
const missing = required.filter(key => !process.env[key]?.trim());
if (once && missing.length) throw new Error(`Set ${missing.join(', ')} in .env.server`);
const config = {
  sender:sample?'avigilonalerts@vcs.net':process.env.CAMERA_SENDER,
  subject:sample?'':process.env.CAMERA_SUBJECT || '',
  marker:sample?'BEI Bus has arrived.':process.env.CAMERA_MARKER,
  checkpoint:sample?'BEI campus corner':process.env.CAMERA_CHECKPOINT || 'BEI campus corner',
  recipient:process.env.RESEND_INBOUND_ADDRESS, webhookSecret:process.env.RESEND_WEBHOOK_SECRET,
  webhookId:process.env.RESEND_WEBHOOK_ID, webhookUrl:process.env.RESEND_WEBHOOK_URL,
  cooldownSeconds:Number(process.env.CAMERA_COOLDOWN_SECONDS || 30),
};
const statePath = process.env.ALERT_STATE_FILE || (sample ? '.data/sample-alerts.json' : '.data/alerts.json');
const historyPath = statePath.replace(/\.json$/, '') + '.sqlite';
const history = openHistory(historyPath, {legacyPath:statePath, collector:{
  commit:process.env.BUSTRACKR_COMMIT || null, source:collectorSource(fileURLToPath(new URL('.', import.meta.url))), parser:PARSER,
}});
const state = history.state;
let sampleReports=[];
let status = sample ? 'sample' : missing.length ? 'disconnected' : 'connecting';
let lastCheckedAt = null;
const port = Number(process.env.ALERT_PORT || 8787);
const interval = Number(process.env.RESEND_HEALTH_SECONDS || 30);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(interval) || interval < 5 || interval > 60 || !Number.isFinite(config.cooldownSeconds) || config.cooldownSeconds<0 || config.cooldownSeconds>300) throw new Error('Invalid port, health interval, or cooldown setting');
if (!sample && !missing.length && (!/^https:\/\//.test(config.webhookUrl) || !config.recipient.split(',').every(value => /^[^\s@]+@[^\s@]+$/.test(value.trim())))) throw new Error('Set an HTTPS webhook URL and receiving email address');
const api = sample ? null : resendApi(process.env.RESEND_API_KEY);
const receiver = sample || missing.length ? null : createReceiver({history, config, api});
if (sample) {
  if (!state.events.length) {
    // Four days of sightings at the same time of day, the last two minutes ago, so the model has a run to learn.
    const fixture = await readFile(new URL('./fixtures/avigilon-alert.eml', import.meta.url),'utf8');
    for (const daysAgo of [3,2,1,0]) {
      const seen = new Date(Date.now()-120_000-daysAgo*86_400_000);
      const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'}).formatToParts(seen).map(p=>[p.type,p.value]));
      const stamp=`[${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.dayPeriod} (${p.timeZoneName})]`;
      const email=fixture.replace(/\[2026-Oct-16[^\]]+\]/,stamp).replace(/^Message-ID: <([^>]+)>/mi,`Message-ID: <sample-${daysAgo}-$1>`);
      history.record(await parseAlert(email,config,new Date(seen.getTime()+30_000)),null,config.cooldownSeconds);
    }
  }
  // Riders reported the bus at Fehren eight minutes after each earlier sample sighting, so the sample learns a trip.
  sampleReports=state.events.filter(e=>Date.now()-Date.parse(e.eventAt)>86_400_000/2).map(e=>({receivedAt:new Date(Date.parse(e.eventAt)+480_000).toISOString(),verdict:'arrived',stop:'fehren'}));
  lastCheckedAt = new Date().toISOString();
}
let quality={key:null,value:null};
function modelQuality(now) {
  const key=`${state.events.length}:${serviceDate(now)}`;
  if (quality.key!==key) quality={key,value:backtest(state.events,{checkpoint:config.checkpoint,now})};
  return quality.value;
}
function payload() {
  const checkAge=lastCheckedAt ? Date.now()-Date.parse(lastCheckedAt) : Infinity;
  const feedStatus=sample?'sample':status==='connected' && (checkAge>90_000 || !receiver.healthy)?'disconnected':status;
  const now=new Date();
  const prediction=estimate(state.events,{checkpoint:config.checkpoint,reports:sample?sampleReports:feedback?.reports() ?? [],now,quality:modelQuality(now)});
  if (!sample && feedStatus!=='connected') {prediction.marker=null;prediction.status='offline';prediction.reason='Inbound email feed is not current; position estimate hidden.';}
  return {status:feedStatus,lastCheckedAt,latest:state.latest,eventCount:state.events.length,prediction};
}
const allowedOrigins=(process.env.ALERT_ALLOWED_ORIGIN || '').split(',').map(value=>value.trim()).filter(Boolean);
const delivery=notificationDelivery(sample?{}:process.env);
let notifications;
try {
  if(!once)notifications=await createNotificationService({path:process.env.NOTIFICATIONS_STATE_FILE || `${statePath}.notifications`,
    events:()=>sample?[]:state.events,...delivery});
} catch {console.error('Notification storage unavailable; camera ingestion remains active.');}
const unavailableNotifications={publicConfig:()=>({webPushPublicKey:null,expo:false}),
  register:async()=>{throw Object.assign(new Error('Notification storage unavailable'),{status:503});},
  remove:async()=>{throw Object.assign(new Error('Notification storage unavailable'),{status:503});}};
const handleNotifications=notificationRoutes(notifications || unavailableNotifications,{allowedOrigins});
const waitlist=!sample && process.env.RESEND_API_KEY?.trim() && process.env.WAITLIST_SEGMENT_ID?.trim() && process.env.WAITLIST_FROM?.trim()
  ?createWaitlist({apiKey:process.env.RESEND_API_KEY,segmentId:process.env.WAITLIST_SEGMENT_ID,from:process.env.WAITLIST_FROM}):null;
const handleWaitlist=waitlistRoutes(waitlist,{allowedOrigins});
let accounts;
try {if(!sample && !once)accounts=openAccounts(accountsPath(process.env));}
catch {console.error('Account storage unavailable; pilot sign-in is closed.');}
const mailer=!sample && process.env.RESEND_API_KEY?.trim() && process.env.WAITLIST_FROM?.trim()?createMailer({apiKey:process.env.RESEND_API_KEY,from:process.env.WAITLIST_FROM}):null;
const handleSession=sessionRoutes({accounts,mailer,sample,allowedOrigins,siteUrl:pilotSiteUrl(process.env)});
const dashboard=process.env.SIGHTINGS_UMAMI_URL && process.env.SIGHTINGS_UMAMI_WEBSITE?
  dashboardSync(history,umamiSink({url:process.env.SIGHTINGS_UMAMI_URL,website:process.env.SIGHTINGS_UMAMI_WEBSITE})):null;
function maintainHistory() {
  dashboard?.().catch(error=>console.error(`Dashboard sync failed; will retry. ${error.message}`));
  try {const file=history.snapshot(join(dirname(historyPath),'backups'));if(file)console.log(`Saved camera history snapshot ${file}`);}
  catch {console.error('Camera history snapshot failed; will retry.');}
}
const historyTimer=once?null:setInterval(maintainHistory,60_000);
if(!once)maintainHistory();
let feedback;
try {
  feedback=await createFeedbackLog({path:process.env.FEEDBACK_FILE || `${statePath}.feedback.jsonl`,
    prediction:()=>payload().prediction,commit:process.env.BUSTRACKR_COMMIT || null});
} catch {console.error('Feedback storage unavailable; camera ingestion remains active.');}
const handleFeedback=feedbackRoutes(feedback || {record:async()=>{throw new Error('Feedback storage unavailable');}},{allowedOrigins});
let notifying=false;
const notificationTimer=!once && !sample && notifications && (delivery.config.expo || delivery.config.webPushPublicKey)?setInterval(()=>{
  if(notifying)return;
  notifying=true;notifications.tick().catch(()=>console.error('Notification processing failed; camera ingestion remains active.')).finally(()=>{notifying=false;});
},5000):null;
const server = createServer(async (req,res)=>{
  const origin=req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin'); res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','application/json');
  if (await handleNotifications(req,res)) return;
  if (await handleWaitlist(req,res)) return;
  if (await handleSession(req,res)) return;
  if (await handleFeedback(req,res)) return;
  if (req.method === 'GET' && req.url === '/api/health') {res.end(JSON.stringify({status:missing.length?'needs_configuration':payload().status,storage:'local',missing}));return;}
  if (req.method === 'POST' && req.url === '/api/resend/inbound') {
    if (!receiver) {res.writeHead(503);res.end(JSON.stringify({error:'Receiver needs configuration'}));return;}
    try {
      const raw = await boundedText(req, 64_000);
      const result = await receiver.handle(raw, req.headers);
      res.writeHead(result.status); res.end(JSON.stringify(result.body));
      if (result.body.stored) maintainHistory();
    } catch {res.writeHead(413); res.end(JSON.stringify({error:'Invalid or oversized request'}));}
    return;
  }
  if (!req.url.startsWith('/api/') && await serveWebsite(req,res,new URL('../website/',import.meta.url))) return;
  if (req.method!=='GET' || !['/api/detections/latest','/api/shuttle'].includes(req.url)) {res.writeHead(404);res.end(JSON.stringify({error:'Not found'}));return;}
  res.end(JSON.stringify(payload()));
});
if (!once) server.listen(port,process.env.ALERT_HOST || '127.0.0.1',()=>console.log(`Detection API on port ${port} (${sample?'sample':'Resend inbound'})`));
let stopping=false;
const abort=new AbortController();
server.requestTimeout = 20_000;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopping=true;abort.abort();if(notificationTimer)clearInterval(notificationTimer);if(historyTimer)clearInterval(historyTimer);server.close();});
if (!sample && !missing.length) {
  while (!stopping) {
    try {
      await checkReceiver(api, config);
      lastCheckedAt=new Date().toISOString();status='connected';
      if (once) console.log('Resend webhook configuration verified.');
    } catch {status='disconnected';console.error('Resend configuration check failed; check API access and webhook settings.');if(once)process.exitCode=1;}
    if (once || stopping) break;
    try {await delay(interval*1000,undefined,{signal:abort.signal});} catch {break;}
  }
}
