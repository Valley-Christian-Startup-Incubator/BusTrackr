# Run the pilot

The tracker at `/app` is open only to pilot members. Signed-out visitors are sent to the waitlist on the landing page. Members sign in with a one-time link sent by email; there are no passwords. The shuttle API stays public on purpose: the gate keeps the audience small, it does not protect the data.

## Let someone in

Waitlist signups are contacts in the Resend segment "BusTrackr pilot waitlist". Pick someone from there, then approve them on valley-big-mac:

```sh
ssh valley-big-mac
cd ~/apps/bustrackr
runtime/node-v24.22.1-darwin-arm64/bin/node --env-file=.env.server server/pilot.mjs approve someone@warriorlife.net
```

The Mac has no `node` on its `PATH`, so use the private runtime as shown. If the runtime is upgraded, change the version in the path to match `ls runtime`.

`approve` adds the member and sends the "you're in" email. Its button signs them in once within 7 days. Running `approve` again for the same email sends nothing; add `--resend` to send a fresh invite. If the first send failed, a plain `approve` sends it.

| Command | Does |
| --- | --- |
| `server/pilot.mjs approve <email> [--resend]` | Add a member and send the invite. |
| `server/pilot.mjs list` | Show members, when they were invited, and how many active sessions each has. |
| `server/pilot.mjs remove <email>` | Remove a member and sign them out everywhere. |

From a local checkout with its own `.env.server`, `npm run pilot:approve -- <email>`, `npm run pilot:list` and `npm run pilot:remove -- <email>` run the same commands against the local `.data/accounts.sqlite`.

## Signing in later

A member who loses the invite, or uses another device, signs in at `/signin` with the same email. They get a link that works once within 15 minutes. A session lasts 90 days. Someone who isn't a member is told to join the waitlist.

## Where it lives

- Members, sign-in links and sessions are in `.data/accounts.sqlite`, beside the camera history. Only SHA-256 hashes of links and sessions are stored.
- Emails send from `WAITLIST_FROM` through the Resend key in `.env.server`. Links point at `PILOT_SITE_URL`.
- `scripts/deploy-worker.sh` ships `server/pilot.mjs` with the rest of the worker, so a worker deploy is all the server needs.

## Known limit

Mail systems that open links to scan them use up the one-time link before the person taps it, and the member lands on "link expired". Student mail (`warriorlife.net`) is Google Workspace, which doesn't do this. Staff mail (`vcs.net`) goes through Proofpoint, which can. If staff report expired links, make the emailed link open a page with a Continue button that signs in on tap.
