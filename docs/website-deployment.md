# Website releases without worker restarts

The deployment controller publishes the product website and the React map from `Valley-Christian-Startup-Incubator/BusTrackr` branch `main`. The watcher checks every 60 seconds. The landing page lives at `/` and the tracker at `/app` (Vite's entry is `app.html`, so the map build no longer overwrites the website's `index.html`). `/about.html` stays as a copy of the landing page. Old `/BusTrackr/` links redirect to `/`, retaining query parameters. It uses `/api/shuttle` on that host.

Website releases do not restart the frontend, camera worker, notification delivery, or Cloudflare tunnel. The camera worker remains the only writer of camera and notification state. Backend code upgrades, persistent schema changes, and host upgrades remain separate operations. Do not claim that this controller provides rolling upgrades for those processes.

## Prepare the host

Use the installed Node 24.22.1 runtime and Python 3.9 or newer. Keep the existing environment file and `.data` directory outside every release. Install `scripts/deploy-website.py` as `~/apps/bustrackr/deploy-website/controller.py`. Keep this controller pinned until its replacement passes the offline tests.

Before installing or updating the controller or watcher, acquire an exclusive nonblocking lock on `~/apps/bustrackr/deploy-website/lock`. Hold it through the installation. If another process holds the lock, wait for that deployment to finish. Do not unload a running watcher to bypass the lock.

Install the standalone frontend handler before adopting a website that contains the map. Before publishing the root-path migration, update the pinned controller under the deployment lock and install the updated frontend handler so old `/BusTrackr/` URLs redirect to `/`. The running frontend must load that handler before promotion; this is a separate frontend process update. The controller previews each candidate with that installed handler on a temporary loopback port. It never starts a second camera worker.

Adopt the current live directory once. This copies the current website, validates it, and atomically exchanges the live directory for a release symlink. The original directory remains at the recorded legacy path. The exchange uses macOS `renameatx_np` or Linux `renameat2`. An unsupported filesystem operation fails without a rename fallback.

```sh
python3 ~/apps/bustrackr/deploy-website/controller.py --root ~/apps/bustrackr --node ~/apps/bustrackr/runtime/node-v24.22.1-darwin-arm64/bin/node adopt
```

The existing static handler resolves the root directory on each request. It therefore sees a complete old or new release. Already open responses continue through their existing process.

Install `deploy/com.valley.bustrackr.website-deploy.plist` in `~/Library/LaunchAgents/`. The classroom host uses launchd domain `user/501`. The watcher runs the installed controller, not a file from an incoming release. Use `launchctl bootstrap user/501` only after adoption and public health checks pass. Verify a real reviewed push before reporting automatic deployment as operational.

## Deploy and inspect a release

```sh
python3 ~/apps/bustrackr/deploy-website/controller.py status
python3 ~/apps/bustrackr/deploy-website/controller.py --node ~/apps/bustrackr/runtime/node-v24.22.1-darwin-arm64/bin/node deploy
```

The bare source repository must retain the canonical origin. Fetches target only `main`. A non-fast-forward update fails. The controller never resets a dirty checkout because it never uses a working checkout.

Each attempt exports the commit into a separate release directory. It installs the locked root and mobile dependencies required by the shared TypeScript modules, builds the React map, and preserves the product overview as `website/about.html` and stages the map directly into `website/`. The build sets `VITE_ALERT_API_URL=/api/shuttle`. It validates HTML references, content-hashed website assets, map resources, and the actual frontend handler before promotion. Build output is private at `deploy-website/build-COMMIT.log`.

The controller uses a descriptive browser-compatible health-check User-Agent because Cloudflare Browser Integrity Check rejects Python's default User-Agent. The controller inserts a release marker in each HTML document. It probes the public homepage and API before promotion, then verifies the selected release marker on the public pages afterward. A failed post-promotion check restores the previous release. The controller records the failed commit and skips it until a newer commit arrives or an operator runs `deploy --retry`.

A prebuilt website can be published with the same validation and rollback checks. This is useful for an urgent verified artifact. It does not change the watched branch baseline.

```sh
python3 ~/apps/bustrackr/deploy-website/controller.py deploy --artifact /absolute/path/to/built-website
```

A prebuilt directory must include the root tracker build (`index.html`, `manifest.webmanifest`, and its assets) if the live release already hosts the map. Legacy releases with `BusTrackr/index.html` remain supported for rollback. A website-only payload cannot remove the map.

## Pause, resume, and roll back

```sh
python3 ~/apps/bustrackr/deploy-website/controller.py pause
python3 ~/apps/bustrackr/deploy-website/controller.py resume
python3 ~/apps/bustrackr/deploy-website/controller.py rollback
```

Pause and resume acquire the same lock as deployment. Pausing takes effect after an already running deployment finishes. It suppresses automatic and ordinary manual `deploy` commands. An explicit prebuilt artifact deployment remains available while paused. Rollback also works while paused.

State lives in `deploy-website/state.json`. It records the active and previous releases, source branch baseline, failed commit, and any pending switch. A journal write precedes the atomic symlink replacement. If the controller stops during a switch, the next command restores the prior release before doing other work. The filesystem link is checked against the journal rather than assuming a state write completed.

Rollback retains the reverted commit as failed so the unchanged watcher does not immediately publish it again. Rollback to the original unmanaged directory requires inspection of the recorded legacy path. Normal managed releases support the `rollback` command.

## Retain assets and verify continuity

Versioned website CSS and JavaScript go into an append-only asset registry. The controller verifies the filename hash against the bytes. Vite assets under `assets` (and legacy `BusTrackr/assets`) use Vite filenames and reject a filename collision with different bytes. Before promotion, the controller adds these assets to the candidate and live release roots with hardlinks. It hydrates the selected rollback root from the registry before switching. Failed release directories never contribute assets to later attempts. Existing asset bytes never change. This also lets an old document fetch a newer asset after a rollback.

The active and previous releases and the original adopted directory are retained. This first controller does not delete old release payloads or the asset registry. Inspect disk use before adding a retention policy. Never remove an asset that a retained document can request. Never delete a release while a response may still be reading it.

Run the isolated checks before updating the installed controller.

```sh
python3 scripts/test-deploy-website.py
```

The checks use the actual static handler. They exercise continuous requests during adoption and promotion, an in-flight response, retained assets after promotion and rollback, a broken candidate, a failed public probe, interrupted-switch recovery, deployment locking, pause behavior, and source divergence. They do not establish public availability or verify the installed watcher. Verify those on the host after installation.

## Current production layout

The public Cloudflare tunnel routes both hostnames to the stable frontend at `127.0.0.1:18788`. The frontend serves the current website root and streams `/api/*` to the existing camera worker at `127.0.0.1:18787`. The launchd labels are `com.valley.bustrackr.frontend`, `com.valley.bustrackr`, and `com.cloudflare.bustrackr`. Website releases do not reload these jobs.

The retired Vercel backend sources and GitHub Pages deployment workflow have been removed. The self-hosted map is available at `https://bustrackr.valleychristianai.com/app`.
