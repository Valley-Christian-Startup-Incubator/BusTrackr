import {Webhook} from 'svix';
import {z} from 'zod';
import {parseAlert, recordAlert} from './alerts.mjs';

const address = z.string().min(1).max(320).refine(value => !/[\r\n]/.test(value));
const emailSchema = z.object({
  id: z.string().uuid(), from: address, to: z.array(address), subject: z.string().max(2000),
  created_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
  message_id: z.string().max(1000).optional(), text: z.string().nullable(), html: z.string().nullable(),
  headers: z.record(z.string(), z.string()).optional(),
  authentication: z.object({dkim: z.string(), dmarc: z.string()}).nullable().optional(),
});
const eventSchema = z.object({type: z.literal('email.received'), data: z.object({email_id: z.string().uuid(), to: z.array(address)})});
const forRecipient = (recipients, recipient) => recipients.some(value => recipient.split(',').map(address => address.trim().toLowerCase()).includes(value.toLowerCase()));
export async function boundedText(stream, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > limit) throw new Error('Body exceeds limit');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function resendApi(apiKey, fetchImpl = fetch) {
  return async path => {
    const response = await fetchImpl(`https://api.resend.com${path}`, {
      headers: {Authorization: `Bearer ${apiKey}`}, signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!response.ok) {await response.body?.cancel(); throw new Error('Resend request failed');}
    return JSON.parse(await boundedText(response.body, 2_000_000));
  };
}
export async function checkReceiver(api, config) {
  const webhook = await api(`/webhooks/${encodeURIComponent(config.webhookId)}`);
  if (webhook.status !== 'enabled' || webhook.endpoint !== config.webhookUrl ||
      !webhook.events?.includes('email.received') || webhook.signing_secret !== config.webhookSecret) {
    throw new Error('Resend webhook configuration does not match this receiver');
  }
}
export async function receivedAlert(input, config) {
  const mail = emailSchema.parse(input);
  if (!forRecipient(mail.to, config.recipient)) return null;
  if (mail.authentication?.dkim !== 'pass' && mail.authentication?.dmarc !== 'pass') return null;
  const header = value => value?.replace(/[\r\n]/g, ' ') || '';
  const text = mail.text || mail.html || '';
  const source = [
    `From: ${header(mail.from)}`, `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString('base64')}?=`,
    `Message-ID: ${header(mail.message_id || `<resend-${mail.id}>`)}`,
    `Date: ${header(mail.headers?.date || mail.headers?.Date)}`,
    `Content-Type: ${mail.text ? 'text/plain' : 'text/html'}; charset=utf-8`,
    'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64'),
  ].join('\r\n');
  return parseAlert(source, config, new Date(mail.created_at));
}
export function verifyReceivingEvent(raw, headers, config) {
  try {new Webhook(config.webhookSecret).verify(raw, headers);} catch {return {status:400, body:{error:'Invalid webhook signature'}};}
  let event;
  try {event = JSON.parse(raw);} catch {return {status:400, body:{error:'Invalid webhook event'}};}
  if (!event || typeof event !== 'object') return {status:400, body:{error:'Invalid webhook event'}};
  if (event.type !== 'email.received') return {status:200, body:{ignored:true}};
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success) return {status:400, body:{error:'Invalid receiving event'}};
  if (!forRecipient(parsed.data.data.to, config.recipient)) return {status:200, body:{ignored:true}};
  return {id:parsed.data.data.email_id};
}
export function createReceiver({state, config, api, persist}) {
  let queue = Promise.resolve(), pending = 0;
  const failures = new Set();
  return {
    get healthy() {return failures.size === 0;},
    async handle(raw, headers) {
      const verified = verifyReceivingEvent(raw, headers, config);
      if (!verified.id) return verified;
      const {id} = verified;
      if (pending >= 32) return {status: 503, body: {error: 'Receiver busy; retry later'}};
      pending++;
      const process = async () => {
        if (state.resendReceipts?.includes(id)) {failures.delete(id); return {status: 200, body: {duplicate: true}};}
        const mail = await api(`/emails/receiving/${id}?html_format=cid`);
        if (mail.id !== id) throw new Error('Received email ID mismatch');
        const alert = await receivedAlert(mail, config);
        const next = structuredClone(state);
        const stored = recordAlert(next, alert, config.cooldownSeconds);
        next.resendReceipts = [...(next.resendReceipts || []), id];
        await persist(next);
        Object.assign(state, next);
        failures.delete(id);
        return {status: 200, body: {stored}};
      };
      const task = queue.then(process);
      queue = task.catch(() => {});
      try {return await task;} catch {failures.add(id); return {status: 503, body: {error: 'Email processing failed; retry later'}};}
      finally {pending--;}
    },
  };
}
