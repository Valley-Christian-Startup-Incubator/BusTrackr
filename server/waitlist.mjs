import {z} from 'zod';
import {boundedText} from './resend.mjs';
import {renderEmail} from './email.mjs';
import {requestLimiter} from './notifications.mjs';

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
    if (method === 'GET' && response.ok) return {status: response.status, body: await response.json()};
    await response.body?.cancel();
    return {status: response.status};
  };
  const ok = ({status}) => status >= 200 && status < 300;
  const must = result => {if (!ok(result)) throw new Error('Resend request failed');};
  return {
    async join(email) {
      const contact = `/contacts/${encodeURIComponent(email)}`;
      const existing = await call('GET', contact);
      if (existing.status !== 200 && existing.status !== 404) throw new Error('Resend request failed');
      if (existing.status === 200) {
        // The Resend account is shared with other Valley mailings, so a contact can exist without being on the waitlist.
        const segments = await call('GET', `${contact}/segments?limit=100`);
        must(segments);
        if (segments.body.data?.some(segment => segment.id === segmentId)) return {alreadyJoined: true};
        must(await call('POST', `${contact}/segments/${encodeURIComponent(segmentId)}`));
      } else {
        must(await call('POST', '/contacts', {email, segments: [{id: segmentId}]}));
      }
      // Only someone newly added to the segment gets a confirmation, so the form can't be used to send someone repeated mail.
      const sent = await call('POST', '/emails', {from, to: [email], ...confirmation}, {'Idempotency-Key': `waitlist/${email}`}).catch(() => ({status: 0}));
      if (!ok(sent)) console.error('Waitlist confirmation email failed; the signup was saved.');
      return {alreadyJoined: false};
    },
  };
}

export function waitlistRoutes(waitlist, {allowedOrigins = [], now = Date.now} = {}) {
  const allow = requestLimiter({max: 5, windowMs: 600_000, now});
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
    if (!allow(req)) return respond(429, {error: 'Too many signups from this network. Try again later.'});
    if (!req.headers['content-type']?.startsWith('application/json')) return respond(415, {error: 'Use application/json'});
    let signup;
    try {signup = signupSchema.parse(JSON.parse(await boundedText(req, 4000)));}
    catch {return respond(400, {error: 'Enter a valid email address.'});}
    if (signup.website) return respond(200, {joined: true});
    if (!waitlist) return respond(503, {error: 'The waitlist is closed right now.'});
    try {const {alreadyJoined} = await waitlist.join(signup.email); return respond(200, {joined: true, alreadyJoined});}
    catch {return respond(503, {error: "We couldn't save that right now. Try again in a minute."});}
  };
}
