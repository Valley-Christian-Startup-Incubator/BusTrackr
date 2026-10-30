import {readFile} from 'node:fs/promises';
import {boundedText, checkReceiver, resendApi} from '../server/resend.mjs';
import {createBlobState} from '../server/blob-state.mjs';
import {receiveCloudEmail} from '../server/cloud-receiver.mjs';
import {estimate, validateSchedule} from '../server/estimator.mjs';

export const config = {api:{bodyParser:false}};
const required = ['RESEND_API_KEY','RESEND_WEBHOOK_SECRET','RESEND_WEBHOOK_ID','RESEND_WEBHOOK_URL','RESEND_INBOUND_ADDRESS','CAMERA_SENDER','CAMERA_MARKER'];
const store = createBlobState();
const schedule = validateSchedule(JSON.parse(await readFile(new URL('../server/schedule.json', import.meta.url),'utf8')));
export default async function handler(req, res) {
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Origin');
  if (process.env.ALERT_ALLOWED_ORIGIN && req.headers.origin === process.env.ALERT_ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin',process.env.ALERT_ALLOWED_ORIGIN);
  const send = (status, body) => {res.statusCode = status; res.end(JSON.stringify(body));};
  const path = new URL(req.url, 'https://localhost').pathname;
  const missing = required.filter(key => !process.env[key]?.trim());
  const settings = {
    recipient:process.env.RESEND_INBOUND_ADDRESS, webhookSecret:process.env.RESEND_WEBHOOK_SECRET,
    webhookId:process.env.RESEND_WEBHOOK_ID, webhookUrl:process.env.RESEND_WEBHOOK_URL,
    sender:process.env.CAMERA_SENDER, marker:process.env.CAMERA_MARKER, subject:process.env.CAMERA_SUBJECT || '',
    checkpoint:process.env.CAMERA_CHECKPOINT || 'BEI campus corner', cooldownSeconds:Number(process.env.CAMERA_COOLDOWN_SECONDS || 30),
  };
  try {
    if (path === '/api/resend/inbound' && req.method === 'POST') {
      if (missing.length) return send(503,{error:'Receiver needs configuration'});
      let raw;
      try {raw = await boundedText(req,64_000);} catch {return send(413,{error:'Invalid or oversized request'});}
      const result = await receiveCloudEmail({raw, headers:req.headers, config:settings, api:resendApi(process.env.RESEND_API_KEY), store});
      return send(result.status,result.body);
    }
    if (req.method !== 'GET' || !['/api/health','/api/shuttle','/api/detections/latest'].includes(path)) return send(404,{error:'Not found'});
    const state = await store.read();
    let connected = false, lastCheckedAt = null;
    if (!missing.length) {
      try {await checkReceiver(resendApi(process.env.RESEND_API_KEY),settings); connected = !state.pending?.length; lastCheckedAt = new Date().toISOString();} catch {}
    }
    if (path === '/api/health') return send(200,{status:missing.length?'needs_configuration':connected?'connected':'disconnected',storage:'connected',missing});
    const prediction = estimate(schedule,state.events);
    if (!connected) {prediction.marker=null; prediction.status='offline'; prediction.reason='Inbound email feed is not current; position estimate hidden.';}
    return send(200,{status:connected?'connected':'disconnected',lastCheckedAt,latest:state.latest,eventCount:state.events.length,prediction});
  } catch {return send(503,{error:'Backend temporarily unavailable'});}
}
