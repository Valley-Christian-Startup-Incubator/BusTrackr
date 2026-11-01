import {serveWebsite} from './website.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {boundedText, checkReceiver, createReceiver, resendApi} from './resend.mjs';
import {loadState, saveState, parseAlert, recordAlert} from './alerts.mjs';
import {estimate, validateSchedule} from './estimator.mjs';

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
const state = await loadState(statePath);
let schedule = validateSchedule(JSON.parse(await readFile(process.env.ALERT_SCHEDULE_FILE || new URL('./schedule.json', import.meta.url), 'utf8')));
let status = sample ? 'sample' : missing.length ? 'disconnected' : 'connecting';
let lastCheckedAt = null;
const port = Number(process.env.ALERT_PORT || 8787);
const interval = Number(process.env.RESEND_HEALTH_SECONDS || 30);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(interval) || interval < 5 || interval > 60 || !Number.isFinite(config.cooldownSeconds) || config.cooldownSeconds<0 || config.cooldownSeconds>300) throw new Error('Invalid port, health interval, or cooldown setting');
if (!sample && !missing.length && (!/^https:\/\//.test(config.webhookUrl) || !config.recipient.split(',').every(value => /^[^\s@]+@[^\s@]+$/.test(value.trim())))) throw new Error('Set an HTTPS webhook URL and receiving email address');
const api = sample ? null : resendApi(process.env.RESEND_API_KEY);
const receiver = sample || missing.length ? null : createReceiver({state, config, api, persist: next => saveState(statePath, next)});
if (sample) {
  if (!state.events.length) {
    const seen = new Date(Date.now()-120_000);
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'}).formatToParts(seen).map(p=>[p.type,p.value]));
    const stamp=`[${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.dayPeriod} (${p.timeZoneName})]`;
    const fixture = (await readFile(new URL('./fixtures/avigilon-alert.eml', import.meta.url),'utf8')).replace(/\[2026-Oct-16[^\]]+\]/,stamp);
    recordAlert(state,await parseAlert(fixture,config));
    await saveState(statePath,state);
  }
  const event=state.events.find(e=>!e.duplicateOf && e.eventAt);
  if (!event) throw new Error('Remove or migrate legacy sample state to run the new sample');
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(event.eventAt));
  schedule=validateSchedule({version:'SAMPLE-ONLY',confirmed:true,runs:[{id:'sample-run',days:[0,1,2,3,4,5,6],time,checkpoint:config.checkpoint,checkpointProgress:.05,direction:'outbound',durationSeconds:480}]});
  lastCheckedAt = new Date().toISOString();
}
function payload() {
  const checkAge=lastCheckedAt ? Date.now()-Date.parse(lastCheckedAt) : Infinity;
  const feedStatus=sample?'sample':status==='connected' && (checkAge>90_000 || !receiver.healthy)?'disconnected':status;
  const prediction=estimate(schedule,state.events);
  if (!sample && feedStatus!=='connected') {prediction.marker=null;prediction.status='offline';prediction.reason='Inbound email feed is not current; position estimate hidden.';}
  return {status:feedStatus,lastCheckedAt,latest:state.latest,eventCount:state.events.length,prediction};
}
const server = createServer(async (req,res)=>{
  const origin=process.env.ALERT_ALLOWED_ORIGIN;
  if (origin && req.headers.origin===origin) res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin'); res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','application/json');
  if (req.method === 'GET' && req.url === '/api/health') {res.end(JSON.stringify({status:missing.length?'needs_configuration':payload().status,storage:'local',missing}));return;}
  if (req.method === 'POST' && req.url === '/api/resend/inbound') {
    if (!receiver) {res.writeHead(503);res.end(JSON.stringify({error:'Receiver needs configuration'}));return;}
    try {
      const raw = await boundedText(req, 64_000);
      const result = await receiver.handle(raw, req.headers);
      res.writeHead(result.status); res.end(JSON.stringify(result.body));
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
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopping=true;abort.abort();server.close();});
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
