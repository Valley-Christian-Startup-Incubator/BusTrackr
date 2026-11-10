import {DatabaseSync} from 'node:sqlite';
import {createHash, randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {z} from 'zod';
import {boundedText} from './resend.mjs';
import {renderEmail} from './email.mjs';
import {requestLimiter} from './notifications.mjs';

const schema = `
CREATE TABLE IF NOT EXISTS members (email TEXT PRIMARY KEY, approved_at TEXT NOT NULL, invited_at TEXT);
CREATE TABLE IF NOT EXISTS login_tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);`;
const signInMinutes = 15;
const sessionDays = 90;
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const hash = token => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export function openAccounts(path, {now = () => new Date()} = {}) {
  mkdirSync(dirname(path), {recursive: true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; ${schema}`);
  const later = ms => new Date(now().getTime() + ms).toISOString();
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {const result = work(); db.exec('COMMIT'); return result;} catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  return {
    approve: email => db.prepare('INSERT OR IGNORE INTO members (email, approved_at) VALUES (?, ?)').run(email, now().toISOString()).changes === 1,
    isMember: email => Boolean(db.prepare('SELECT 1 FROM members WHERE email = ?').get(email)),
    issueLoginToken(email, ms = signInMinutes * 60_000) {
      const login = token();
      db.prepare('DELETE FROM login_tokens WHERE expires_at <= ?').run(now().toISOString());
      db.prepare('INSERT INTO login_tokens (hash, email, expires_at) VALUES (?, ?, ?)').run(hash(login), email, later(ms));
      return login;
    },
    // The token is marked used and the session created together, so a double-clicked link yields one session.
    signIn: login => transaction(() => {
      const at = now().toISOString();
      const row = db.prepare(`UPDATE login_tokens SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ?
        AND email IN (SELECT email FROM members) RETURNING email`).get(at, hash(login), at);
      if (!row) return null;
      const session = token();
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(at);
      db.prepare('INSERT INTO sessions (hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hash(session), row.email, at, later(sessionDays * 86_400_000));
      return session;
    }),
    sessionEmail: session => db.prepare('SELECT email FROM sessions JOIN members USING (email) WHERE hash = ? AND expires_at > ?')
      .get(hash(session), now().toISOString())?.email ?? null,
    signOut: session => {db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash(session));},
    close: () => db.close(),
  };
}

export function sessionRoutes({accounts, mailer, siteUrl, sample = false, allowedOrigins = [], now = Date.now}) {
  const allow = requestLimiter({max: 5, windowMs: 600_000, now});
  const sessionCookie = (value, maxAge) => `bt_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  return async (req, res) => {
    const {pathname, searchParams} = new URL(req.url, 'http://localhost');
    if (pathname !== '/api/session' && !pathname.startsWith('/api/session/')) return false;
    const respond = (status, body, headers = {}) => {res.writeHead(status, headers); res.end(body === undefined ? undefined : JSON.stringify(body)); return true;};
    const session = req.headers.cookie?.match(/(?:^|;\s*)bt_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
    if (req.method === 'GET' && pathname === '/api/session') {
      if (sample) return respond(200, {email: null, sample: true});
      if (!accounts) return respond(503, {error: 'Sign-in is unavailable right now.'});
      const email = session && accounts.sessionEmail(session);
      return email ? respond(200, {email}) : respond(401, {error: 'Not signed in'});
    }
    if (req.method === 'GET' && pathname === '/api/session/verify') {
      const login = searchParams.get('token');
      const signedIn = accounts && login && accounts.signIn(login);
      if (!signedIn) return respond(303, undefined, {Location: '/signin?error=expired'});
      return respond(303, undefined, {Location: '/app', 'Set-Cookie': sessionCookie(signedIn, sessionDays * 86_400)});
    }
    if (req.method !== 'POST' || !['/api/session/link', '/api/session/logout'].includes(pathname)) return respond(404, {error: 'Not found'});
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return respond(403, {error: 'Origin is not allowed'});
    if (pathname === '/api/session/logout') {
      if (session) accounts?.signOut(session);
      return respond(200, {signedOut: true}, {'Set-Cookie': sessionCookie('', 0)});
    }
    if (!allow(req)) return respond(429, {error: 'Too many sign-in requests from this network. Try again later.'});
    if (!req.headers['content-type']?.startsWith('application/json')) return respond(415, {error: 'Use application/json'});
    let email;
    try {email = emailSchema.parse(JSON.parse(await boundedText(req, 4000)).email);}
    catch {return respond(400, {error: 'Enter a valid email address.'});}
    if (!accounts || !mailer) return respond(503, {error: 'Sign-in is unavailable right now.'});
    if (!accounts.isMember(email)) return respond(404, {error: "That email isn't in the pilot yet. Join the waitlist and we'll email you when there's a spot."});
    const url = new URL('/api/session/verify', siteUrl);
    url.searchParams.set('token', accounts.issueLoginToken(email));
    try {await mailer(email, signInEmail(url.href));}
    catch {return respond(503, {error: "We couldn't send the email right now. Try again in a minute."});}
    return respond(200, {sent: true});
  };
}

const signInEmail = url => renderEmail({
  subject: 'Your BusTrackr sign-in link',
  paragraphs: [
    `Tap the button to sign in to BusTrackr. The link works once and expires in ${signInMinutes} minutes.`,
    "Didn't ask for this? Ignore this email and nothing happens.",
  ],
  button: {label: 'Sign in to BusTrackr', url},
});
