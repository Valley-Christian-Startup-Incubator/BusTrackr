import {isIP} from 'node:net';
import {z} from 'zod';
import {boundedText} from './resend.mjs';
import {renderEmail} from './email.mjs';

// `website` is a hidden honeypot field: people leave it empty, form-filling bots don't.
const signupSchema = z.object({email: z.string().trim().toLowerCase().pipe(z.email().max(254)), website: z.string().max(500).optional()});
const confirmation = renderEmail({
  subject: "You're on the BusTrackr pilot waitlist",
  paragraphs: [
    'Thanks for signing up.',
    "BusTrackr is running a limited pilot for the Fehren–Skyway shuttle at Valley Christian. We'll email you when there's a spot for you.",
    "Didn't sign up? Ignore this email and we won't write again.",
  ],
});

export function createWaitlist({apiKey, segmentId, from, fetchImpl = fetch}) {
  const call = async (method, path, body, headers = {}) => {
    const response = await fetchImpl(`https://api.resend.com${path}`, {
      method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error',
      headers: {Authorization: `Bearer ${apiKey}`, ...(body ? {'Content-Type': 'application/json'} : {}), ...headers},
    });
    await response.body?.cancel();
    return response.status;
  };
  const ok = status => status >= 200 && status < 300;
  return {
    async join(email) {
      const contact = `/contacts/${encodeURIComponent(email)}`;
      const existing = await call('GET', contact);
      if (existing !== 200 && existing !== 404) throw new Error('Resend request failed');
      if (existing === 200) {
        if (!ok(await call('POST', `${contact}/segments/${encodeURIComponent(segmentId)}`))) throw new Error('Resend request failed');
        return {created: false};
      }
      if (!ok(await call('POST', '/contacts', {email, segments: [{id: segmentId}]}))) throw new Error('Resend request failed');
      // Only new contacts get a confirmation, so the form can't be used to send someone repeated mail.
      const sent = await call('POST', '/emails', {from, to: [email], ...confirmation}, {'Idempotency-Key': `waitlist/${email}`}).catch(() => 0);
      if (!ok(sent)) console.error('Waitlist confirmation email failed; the signup was saved.');
      return {created: true};
    },
  };
}

export function waitlistRoutes(waitlist, {allowedOrigins = [], now = Date.now} = {}) {
  const requests = new Map();
  return async (req, res) => {
    if (req.url !== '/api/waitlist') return false;
    const respond = (status, body) => {res.writeHead(status); res.end(JSON.stringify(body)); return true;};
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return respond(403, {error: 'Origin is not allowed'});
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return respond(204, null);
    }
    if (req.method !== 'POST') return respond(404, {error: 'Not found'});
    const remote = req.socket.remoteAddress || 'unknown';
    const forwarded = req.headers['cf-connecting-ip'];
    const ip = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : remote;
    const time = now();
    for (const [key, value] of requests) if (value.reset <= time) requests.delete(key);
    const limit = requests.get(ip) || {count: 0, reset: time + 600_000};
    if (requests.size >= 2000 && !requests.has(ip) || ++limit.count > 5) return respond(429, {error: 'Too many signups from this network. Try again later.'});
    requests.set(ip, limit);
    if (!req.headers['content-type']?.startsWith('application/json')) return respond(415, {error: 'Use application/json'});
    let signup;
    try {signup = signupSchema.parse(JSON.parse(await boundedText(req, 4000)));}
    catch {return respond(400, {error: 'Enter a valid email address.'});}
    if (signup.website) return respond(200, {joined: true});
    if (!waitlist) return respond(503, {error: 'The waitlist is closed right now.'});
    try {await waitlist.join(signup.email); return respond(200, {joined: true});}
    catch {return respond(503, {error: "We couldn't save that right now. Try again in a minute."});}
  };
}
