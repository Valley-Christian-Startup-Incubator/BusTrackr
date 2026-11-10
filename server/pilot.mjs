import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {accountsPath, emailSchema, openAccounts, pilotSiteUrl, verifyLink} from './accounts.mjs';
import {createMailer, renderEmail} from './email.mjs';

const inviteDays = 7;
const usage = 'Usage: npm run pilot:approve -- someone@example.com [--resend] | npm run pilot:list | npm run pilot:remove -- someone@example.com';
const inviteEmail = (url, signin) => renderEmail({
  subject: "You're in the BusTrackr pilot",
  paragraphs: [
    "There's a spot for you in the BusTrackr pilot for the Fehren–Skyway shuttle at Valley Christian.",
    `Tap the button to sign in. It works once in the next ${inviteDays} days. After that, or on another device, sign in at ${signin} with this email address.`,
    'If the tracker gets the bus wrong, tap the report button in the app. That feedback is what the pilot is for.',
  ],
  button: {label: 'Open BusTrackr', url},
});

export async function pilot([command, ...args], {accounts, mailer, siteUrl, log = console.log}) {
  const parsed = emailSchema.safeParse(args.find(arg => !arg.startsWith('--')));
  if (command === 'list') {
    const members = accounts.members();
    if (!members.length) return log('No pilot members yet.');
    for (const member of members) log(`${member.email}  approved ${member.approvedAt}  ${member.invitedAt ? `invited ${member.invitedAt}` : 'not invited'}  ${member.sessions} active session(s)`);
    return;
  }
  if (!parsed.success || !['approve', 'remove'].includes(command)) throw new Error(usage);
  const email = parsed.data;
  if (command === 'remove') return log(accounts.remove(email) ? `Removed ${email} and signed them out everywhere.` : `${email} is not in the pilot.`);
  if (!mailer) throw new Error('Set RESEND_API_KEY and WAITLIST_FROM in .env.server to send invites.');
  const member = accounts.approve(email);
  // A member whose invite never went out (say, the send failed) gets it on the next run without --resend.
  if (member.invitedAt && !args.includes('--resend')) return log(`${email} is already in the pilot and was invited ${member.invitedAt}. No email sent; add --resend to send a new invite.`);
  await mailer(email, inviteEmail(verifyLink(siteUrl, accounts.issueLoginToken(email, inviteDays * 86_400_000)), new URL('/signin', siteUrl).href));
  accounts.markInvited(email);
  log(`Approved ${email} and sent the invite.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const accounts = openAccounts(accountsPath(process.env));
  const mailer = process.env.RESEND_API_KEY?.trim() && process.env.WAITLIST_FROM?.trim() ? createMailer({apiKey: process.env.RESEND_API_KEY, from: process.env.WAITLIST_FROM}) : null;
  try {await pilot(process.argv.slice(2), {accounts, mailer, siteUrl: pilotSiteUrl(process.env)});}
  catch (error) {console.error(error.message); process.exitCode = 1;}
  finally {accounts.close();}
}
