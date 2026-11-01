import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {simpleParser} from 'mailparser';

export async function loadState(path) {
  let state;
  try { state = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = {cursor:null, latest:null}; }
  // Preserve the first scaffold's latest observation during migration.
  state.events ??= state.latest ? [state.latest] : [];
  return state;
}
export async function saveState(path, state) {
  await mkdir(dirname(path), {recursive:true});
  await writeFile(`${path}.tmp`, JSON.stringify(state), {mode:0o600});
  await rename(`${path}.tmp`, path);
}
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function cameraTimestamp(text) {
  const match = text.match(/\[(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (AM|PM) \((PDT|PST)\)\]\s*BEI Bus has arrived\b\.?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, period, zone] = match;
  const monthIndex = months.indexOf(month);
  if (monthIndex < 0 || +hour < 1 || +hour > 12 || +minute > 59 || +second > 59 || +day < 1 || +day > 31) return null;
  const h = +hour % 12 + (period === 'PM' ? 12 : 0);
  const date = new Date(Date.UTC(+year, monthIndex, +day, h + (zone === 'PDT' ? 7 : 8), +minute, +second));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23', timeZoneName:'short'}).formatToParts(date).map(p=>[p.type,p.value]));
  if (parts.year !== year || parts.month !== month || parts.day !== day || +parts.hour !== h || parts.minute !== minute || parts.second !== second || parts.timeZoneName !== zone) return null;
  return date.toISOString();
}
export async function parseAlert(source, config, receivedAt = new Date()) {
  if (source.length > 2_000_000) return null;
  const mail = await simpleParser(source, {skipTextToHtml:true});
  const senders = mail.from?.value ?? [];
  if (senders.length !== 1 || senders[0].address?.toLowerCase() !== config.sender.toLowerCase()) return null;
  if (config.subject && !mail.subject?.toLowerCase().includes(config.subject.toLowerCase())) return null;
  const text = mail.text || '';
  if (!text.toLowerCase().includes(config.marker.replace(/\.$/, '').toLowerCase())) return null;
  const eventAt = cameraTimestamp(text);
  if (!eventAt || Date.parse(eventAt) > receivedAt.getTime() + 300_000) return null;
  return {
    id:createHash('sha256').update(mail.messageId || source).digest('hex'),
    checkpoint:config.checkpoint, eventAt, timestampSource:'camera',
    receivedAt:receivedAt.toISOString(),
    reportedAt:mail.date && Number.isFinite(mail.date.getTime()) ? mail.date.toISOString() : null,
    source:'camera-email',
  };
}
export function recordAlert(state, alert, cooldownSeconds = 30) {
  if (!alert) return false;
  state.events ??= state.latest ? [state.latest] : [];
  if (state.events.some(event=>event.id === alert.id)) return false;
  const duplicate = state.events.find(event=>!event.duplicateOf && event.eventAt && event.checkpoint === alert.checkpoint && Math.abs(Date.parse(event.eventAt)-Date.parse(alert.eventAt)) <= cooldownSeconds*1000);
  const stored = {...alert, ...(duplicate ? {duplicateOf:duplicate.id} : {})};
  state.events.push(stored);
  if (!state.latest || Date.parse(alert.eventAt) > Date.parse(state.latest.eventAt || state.latest.receivedAt)) state.latest = stored;
  return true;
}
