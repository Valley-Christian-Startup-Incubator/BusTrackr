# 6. Shipping it

Production is one Mac in a classroom. It's called `valley-big-mac`, and it runs as the user `aimac`. There's no cloud backend. Vercel and GitHub Pages were both used early on, and both are retired.

## What runs on the Mac

```text
 internet
    │
 Cloudflare Tunnel  (bustrackr.valleychristianai.com, bustracker.valleychristianai.com)
    │
    ▼
 frontend      127.0.0.1:18788   server/frontend.mjs   static files + proxies /api/*
    │ /api/*
    ▼
 camera worker 127.0.0.1:18787   server/index.mjs      webhook, API, history, push
```

Three LaunchAgents keep these alive. Each restarts its process if it crashes:

| Label | Runs |
| --- | --- |
| `com.valley.bustrackr` | The camera worker |
| `com.valley.bustrackr.frontend` | The static frontend and API proxy |
| `com.cloudflare.bustrackr` | The tunnel |

A fourth, `com.valley.bustrackr.website-deploy`, runs the deploy controller every 60 seconds.

Both processes bind to loopback only. The tunnel is the only way in. The second hostname, `bustracker` with a "k", exists so links already printed in campaign posts keep working.

These are **LaunchAgents**, not LaunchDaemons. They start when `aimac` logs in, not at boot. After a reboot, someone has to log in. That's on the release-readiness list.

The Mac has no `node` on its `PATH`. The worker uses a private runtime at `~/apps/bustrackr/runtime/node-v24.22.1-darwin-arm64/`. Node 23 and 25 are unsupported everywhere. The supported versions are in `engines` in `package.json`.

## Two deploys, never mixed

The website and the worker ship separately, on purpose.

| | Website and map | Camera worker |
| --- | --- | --- |
| What ships | `website/` pages plus the Vite build of `/app` | `server/*.mjs` except tests and `frontend.mjs` |
| How | The deploy controller, automatic from `main` | `scripts/deploy-worker.sh`, run by a human |
| Restarts the worker? | Never | Yes, briefly |

Why so strict? The worker is the only process that writes camera history and notification state. A website deploy that restarted it would drop webhooks for a few seconds every time someone fixed a typo on the landing page. Resend would retry them, but nothing would be gained.

## CI builds, the Mac doesn't

`.github/workflows/verify.yml` runs on every push and PR. It runs the mobile scene check, the website asset check, all worker tests, the deploy controller tests, the web build, the analytics and landing-feed checks, and the mobile typecheck, lint, tests, and native export.

Then it packages the built site as `website-<commit>.tar.gz`. On a push to `main`, a `publish` job uploads that archive to a GitHub prerelease called `website-builds` and keeps the newest 10.

The Mac downloads that archive. It doesn't run `npm` or Vite. Commit `6469162` made that change. Before it, the classroom Mac built every release itself.

A commit that fails CI never gets an archive, so it can never deploy. Nothing deploys until a later commit passes.

## The deploy controller

`scripts/deploy-website.py` installs on the Mac as `~/apps/bustrackr/deploy-website/controller.py`. Every 60 seconds it:

1. Fetches `main` into a bare repo. It never uses a working checkout, so it never has to reset a dirty one.
2. Downloads the CI archive for the new tip. If CI hasn't finished yet, it does nothing and tries next minute.
3. Rejects the archive if it contains a symlink, an absolute path, or `..`.
4. Unpacks it into a fresh release directory and validates HTML references, hashed assets, and map resources.
5. Previews the release with the real `frontend.mjs` on a temporary loopback port.
6. Writes a journal entry, then swaps the live `website` symlink in one atomic rename.
7. Checks the public site for the new release marker. If that fails, it rolls back.

The handler reads the root directory on every request, so each response comes from one complete release, old or new, never half of each.

Old hashed assets stay available. A browser holding last week's HTML can still fetch last week's CSS. HTML is served `no-store`, and hashed assets are cached for a year as immutable.

The controller **updates itself**. If the new `main` changes `scripts/deploy-website.py` or `server/frontend.mjs`, the controller first runs `scripts/test-deploy-website.py` against that commit. If the tests pass, it installs the new controller and exits. The next run deploys with it. If the tests fail, it keeps the old controller and deploys anyway.

Operators have four commands: `status`, `pause`, `resume`, and `rollback`. A rollback marks the reverted commit as failed so the watcher doesn't republish it a minute later.

### Two real outages it learned from

**GitHub went quiet.** The bare repo had a 30-second low-speed limit. GitHub can stay silent for more than 30 seconds while it builds a pack containing a big file, and the 14 MB mobile scene was a big file. Every fetch timed out. The fix was `http.lowSpeedTime 300` on the bare repo, and later removing the scene from git entirely (chapter 5).

**Cloudflare blocked the controller.** The controller's health checks fetch the public site. Cloudflare Browser Integrity Check rejects Python's default User-Agent, so the health checks failed even though the site was up. The controller now sends a descriptive browser-compatible User-Agent.

## Deploying the worker

```sh
scripts/deploy-worker.sh            # ships origin/main
scripts/deploy-worker.sh <ref>      # ships a specific commit
```

The script:

1. Archives that commit's worker files and copies them over SSH.
2. **Refuses** to deploy if the live server has a `.mjs` file the commit doesn't. Someone hot-copied unmerged code there, and this deploy would silently delete it.
3. Backs up the current `server/` and `.env.server` to `backups/server-<time>.tgz`.
4. Unpacks, sets `BUSTRACKR_COMMIT` in `.env.server`, and restarts the worker.
5. Polls `/api/health` for 30 seconds, and prints the restore command if it never answers.

It never touches `.data/` or the dependencies.

## Letting people in

Pilot members are managed on the Mac:

```sh
ssh valley-big-mac
cd ~/apps/bustrackr
runtime/node-v24.22.1-darwin-arm64/bin/node --env-file=.env.server server/pilot.mjs approve someone@warriorlife.net
```

`approve` is safe to run twice. The second run sends nothing unless you add `--resend`. `list` and `remove` do what they say. `remove` also deletes the member's sessions, which signs them out everywhere.

## What's still missing

From [`release-readiness.md`](../release-readiness.md), and worth knowing before you trust this setup:

- No off-machine backup. The 14 daily snapshots live on the same disk.
- No unattended boot. The services need a login.
- No alert when the worker or tunnel dies.
- No signed app store builds, and no EAS project ID.
- The camera's exact location and direction coverage are still unconfirmed.

---

## Grill session

**Q1.** You fix a typo on the landing page and merge to `main`. List everything that restarts.

<details><summary>Answer</summary>

Nothing. The deploy controller swaps the website symlink. The camera worker, the tunnel, and the frontend keep running. The frontend restarts only when a release changes `server/frontend.mjs`.

</details>

**Q2.** CI is red on your commit, and you merged anyway. When does it reach production?

<details><summary>Answer</summary>

Never on its own. CI publishes an archive only after every check passes. The controller waits for an archive that will never appear. Production stays on the previous release until a later commit passes CI, and that commit carries your change with it.

</details>

**Q3.** Why does the controller fetch into a bare repository instead of keeping a normal checkout and running `git pull`?

<details><summary>Answer</summary>

A working checkout can get dirty, and fixing it automatically means `git reset --hard`, which destroys whatever someone left there. A bare repo has no working tree, so there's nothing to reset. The controller reads the commit it needs and downloads the build from CI.

</details>

**Q4.** Last month, an operator copied a hotfix `server/foo.mjs` straight onto the Mac and never merged it. Today you run `scripts/deploy-worker.sh`. What happens?

<details><summary>Answer</summary>

The script stops before changing anything: "Live worker has files missing from <commit>: server/foo.mjs. Merge that code first; nothing changed." Without that check, the deploy would ship a worker that no longer imports the hotfix, and the hotfix would vanish without anyone noticing.

</details>

**Q5.** A user's browser loaded the landing page HTML five minutes before a deploy. After the deploy, it requests `style.4be92138a7a088b3.css`. Does it get a 404?

<details><summary>Answer</summary>

No. The controller keeps old content-hashed assets in an append-only registry and adds them to each new release. An old document can still load its own CSS and JS. That's also why you run `npm run website:prepare` after editing `website/style.css` or `website/site.js`. It writes a new hashed filename and updates the HTML references.

</details>

**Q6.** The Mac reboots overnight for a macOS update. Is BusTrackr up at 7 AM?

<details><summary>Answer</summary>

Not unless someone logged in as `aimac`. The services are LaunchAgents in the `user/501` domain, so they start at login, not at boot. Resend will retry webhooks for a while, so camera emails sent during the outage can still land once the worker is back, but the site is down until someone logs in.

</details>

**Q7.** Every deploy health check fails with HTTP 403, but the site loads fine in your browser. What's a likely cause in this setup?

<details><summary>Answer</summary>

Cloudflare's Browser Integrity Check is rejecting the controller's requests. It already blocked Python's default User-Agent once, and the controller now sends a descriptive browser-compatible one. If someone changed that header, or Cloudflare tightened its rules, the checks fail while human browsers pass.

</details>
