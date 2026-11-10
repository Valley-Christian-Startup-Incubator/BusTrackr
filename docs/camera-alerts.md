# Camera alert setup

The camera sends alerts to a Resend receiving address. Node 22+ runs a signed inbound-email webhook and status API; GitHub Pages serves only the frontend. Gmail/IMAP polling has been removed.

## Local sample

```sh
npm install
npm run alerts:sample
# In another terminal
npm run dev -- --port 4173 --strictPort
```

Open http://localhost:4173. Camera estimates is the default mode. The sample parses an Avigilon-format fixture with a recent synthetic event time, stores it in `.data/sample-alerts.sqlite`, and uses an explicitly illustrative schedule. The amber map marker and route band show estimated progress; Scene demo switches back to the simulated fleet. A sample event is created only for an empty sample state. After its journey ends the marker disappears; use a new `ALERT_STATE_FILE` for a fresh demo.

The dev server proxies `/api` to port 8787. Production requires `VITE_ALERT_API_URL` pointing to the worker's HTTPS `/api/shuttle` endpoint at frontend build time. `.env.example` documents this public setting. Without it, production shows a configuration notice and hides estimates.

## Hosted backend setup

Production runs on `valley-big-mac` at `/Users/aimac/apps/bustrackr`, behind a dedicated Cloudflare Tunnel. Persistent state is local to that machine. Vercel is no longer the production backend.

| Purpose | URL |
| --- | --- |
| Resend webhook (POST) | `https://bustrackr.valleychristianai.com/api/resend/inbound` |
| Health (GET) | `https://bustrackr.valleychristianai.com/api/health` |
| App status feed (GET) | `https://bustrackr.valleychristianai.com/api/shuttle` |

The original account is now configured on the Mac. Both receiving addresses are enabled in the backend filter:

- `fehren@inbound.valleychristianai.com`
- `fehren2@inbound.valleychristianai.com`

Webhook ID: `b7ce83fc-6a0d-4200-addb-2cf9951cbfed`. Its signing secret and the API key are stored only in the private server environment file. No additional environment setup is needed for this deployment; the steps below document how to reproduce or change it. The root domain `valleychristianai.com` is not enabled for receiving.

### 1. Choose the receiving address

In the **Resend account used by the backend**, open **Emails → Receiving**, then the three-dot menu → **Receiving address** to find the account's `<id>.resend.app` domain. Choose `camera@<id>.resend.app`. This route does not require your own DNS changes. Alternatively, enable receiving on a dedicated custom subdomain and add the MX records Resend supplies; wait for verification. Do not replace an existing normal-mail domain's MX records. See [Resend receiving setup](https://resend.com/docs/dashboard/receiving/introduction).

### 2. Create the webhook and API key

In Resend's **Webhooks** page, add the exact URL above, subscribe to **`email.received`**, and leave the webhook enabled. Save its **ID** and **signing secret** (`whsec_...`). The ID is not the signing secret or a delivered event's ID. Create an API key in this same account that can read received emails and webhook configuration; a sending-only key cannot run this backend. See [Resend webhook setup](https://resend.com/docs/webhooks/introduction).

### 3. Configure the Mac backend

SSH to the machine and edit the private environment file:

```sh
ssh valley-big-mac
nano /Users/aimac/apps/bustrackr/.env.server
```

Fill in these four values from the same Resend account:

```dotenv
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
RESEND_WEBHOOK_ID=
RESEND_INBOUND_ADDRESS=
```

The complete tracked template is [`.env.server.example`](../.env.server.example). The deployed file already has the new webhook URL, camera sender/marker, port `18787`, persistent state path and GitHub Pages CORS origin. Keep actual credentials only in the private file (mode 600). No Vercel variables or Blob token are required.

Restart the backend after saving:

```sh
launchctl kickstart -k user/$(id -u)/com.valley.bustrackr
```

If you already created a Resend webhook for Vercel, change its endpoint to the new URL and use that webhook's ID and signing secret here. Do not run two active webhooks for the same feed unless intentionally testing duplicates.

### 4. Point the camera at Resend and verify

Set each camera's alert recipient to one of the comma-separated addresses in `RESEND_INBOUND_ADDRESS`. Keep its existing sending/SMTP settings; Resend is receiving these messages. Direct delivery is preferred. A forwarded message must preserve the required sender and pass the backend's authentication checks.

Open the health URL. Expected result: `status: "connected"`, `storage: "local"`, and `missing: []`. Before configuration, health reports `needs_configuration` and the webhook returns HTTP 503. A configured but unsigned POST is rejected with HTTP 400. Opening the POST webhook in a browser is not a delivery test.

Trigger a genuine camera alert. Confirm it appears in Resend's Receiving tab and its `email.received` webhook delivery returns HTTP 200. Then open the app status URL: `latest` must contain the actual camera timestamp and `eventCount` must increase. HTTP 200 alone does not prove an alert was stored: unrelated or filtered messages are acknowledged but ignored. The message must match the sender and recipient, have DKIM/DMARC `pass` or a cryptographically verified Google ARC chain with aligned original DMARC `pass`, and contain the configured marker with a valid timestamp such as `[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.` using the actual event time.

Replay failed deliveries from Resend after correcting configuration. There is no automatic historical backfill. Check health for missing variables; for `disconnected`, check API permissions, webhook ID/URL/secret/subscription, and unresolved delivery failures. HTTP 503 after configuration indicates a retryable processing/storage failure.

### 5. Connect the clients

In the mobile app's **Connection settings**, enter `https://bustrackr.valleychristianai.com/api/shuttle` and select **Connect to feed**. Or copy `mobile/.env.example` to `mobile/.env.local`, set `EXPO_PUBLIC_SHUTTLE_API_URL` to that URL, and restart/rebuild the app. A saved connection selection takes precedence.

For the web frontend, copy root `.env.example` to `.env.local`, set `VITE_ALERT_API_URL=https://bustrackr.valleychristianai.com/api/shuttle`, and rebuild/redeploy the frontend. For CI builds, set the variable in that build environment. Both client variables are public; never put Resend credentials in them.

Simple mode shows elapsed minutes since the last sighting without requiring a timetable. Both clients remember the Simple or Map selection. See [notification setup](notifications.md) for optional browser and native push alerts.

A working feed supplies observations. The next expected pass is learned from them, as described in [the estimation design](arrival-estimation-research.md). A map position also needs the trip settings below.

### Templates, persistence and operations

Commit example files, never filled-in files. Root `.env.server.example` is the backend template; root `.env.example` and `mobile/.env.example` contain only public client settings. The retired Vercel deployment sources have been removed. Production does not depend on Vercel.

The backend uses a private Node 24.22.1 runtime at `/Users/aimac/apps/bustrackr/runtime/node-v24.22.1-darwin-arm64`. It does not change the system Node version. Camera history lives at `/Users/aimac/apps/bustrackr/.data/alerts.sqlite` and survives service restarts and deployments. Keep this directory and `.env.server` when updating code. The worker writes a daily snapshot to `.data/backups/sightings-YYYY-MM-DD.sqlite` and keeps 14. No off-machine backup has been configured by this deployment.

Ship worker code with `scripts/deploy-worker.sh [ref]` (default `origin/main`) from a checkout. It copies that commit's non-test `server/*.mjs`, saves the previous `server/` and `.env.server` to `backups/server-<time>.tgz`, sets `BUSTRACKR_COMMIT` and restarts `com.valley.bustrackr`. It leaves `server/schedule.json` and dependencies alone. Pilot member commands run on the same host; see [run the pilot](pilot.md).

Two LaunchAgents run as `aimac`, with automatic restart on failure: `com.valley.bustrackr` and `com.cloudflare.bustrackr`. They are loaded in the `user/501` launchd domain. After a reboot, establish an `aimac` login session and verify both services; if absent, bootstrap the two plists in `~/Library/LaunchAgents` with `launchctl bootstrap user/$(id -u) <plist>`. They are not system LaunchDaemons, so unattended boot before login is not configured. Inspect them remotely:

```sh
ssh valley-big-mac 'launchctl print user/$(id -u)/com.valley.bustrackr; launchctl print user/$(id -u)/com.cloudflare.bustrackr'
ssh valley-big-mac 'tail -n 50 ~/apps/bustrackr/logs/com.valley.bustrackr.err.log'
```

The tunnel configuration is `/Users/aimac/.cloudflared/bustrackr.yml`. It forwards `bustrackr.valleychristianai.com` and `bustracker.valleychristianai.com` to the frontend on `127.0.0.1:18788`, which forwards API requests to the single camera worker on `127.0.0.1:18787`. The second hostname keeps posted campaign links working without removing their query parameters. The tunnel credentials remain on the Mac. Deployment manifests and the minimal backend dependency lockfile are in `deploy/`.

To update backend code from the repository root:

```sh
npm run test:alerts
scp server/index.mjs server/resend.mjs server/forwarded-auth.mjs server/alerts.mjs server/estimator.mjs server/notifications.mjs valley-big-mac:apps/bustrackr/server/
scp deploy/package.json deploy/package-lock.json valley-big-mac:apps/bustrackr/
ssh valley-big-mac 'cd ~/apps/bustrackr && PATH="$HOME/apps/bustrackr/runtime/node-v24.22.1-darwin-arm64/bin:$PATH" npm ci --omit=dev --ignore-scripts && launchctl kickstart -k user/$(id -u)/com.valley.bustrackr'
```

This restarts the single worker briefly; Resend can retry deliveries during downtime. Do not overwrite `.env.server` or `.data/` while deploying.

## Standalone local worker (optional)

For a local live receiver, copy `.env.server.example` to `.env.server`, set `ALERT_PORT=8787` to match the Vite development proxy, and fill in the Resend variables. Its webhook URL must point to a public HTTPS reverse proxy or tunnel reaching this local worker, with a corresponding Resend webhook ID and secret. The hosted URL continues to route to valley-big-mac, not your laptop.

```sh
npm run alerts:check
npm run alerts
```

The check verifies webhook configuration, not camera delivery. The sample mode above needs no credentials. Local `RESEND_HEALTH_SECONDS=30` controls configuration checks only; the production Mac worker uses the same interval.

## Processing behavior

Incoming requests use raw-body Svix signature verification with timestamp tolerance. Only events for `RESEND_INBOUND_ADDRESS` trigger an email-content fetch. The fetched email must match that recipient and have Resend-computed DKIM or DMARC `pass`. For the configured sender forwarded by Gmail, the receiver may instead fetch the bounded raw message and cryptographically verify the complete Google ARC chain with an aligned original DMARC pass. Unverified forwarding headers are never trusted. The existing parser then requires the configured sender and marker and a valid Pacific camera timestamp. No emails are sent, moved, or deleted.

The receiver acknowledges duplicates and irrelevant mail with HTTP 200. API or persistence failures return 503 so Resend retries. Writes are acknowledged only after persistence; the worker serializes writes. Retry IDs survive restarts. Bodies and, when required for ARC verification, raw messages are fetched and parsed transiently. Attachments are never fetched separately or retained; a raw message used for ARC verification can include encoded MIME parts within the same 2 MB limit. Only parsed event metadata, receipt IDs, and pending delivery IDs are persisted. Responses are limited to 2 MB and webhook bodies to 64 KB.

`RESEND_HEALTH_SECONDS` defaults to 30 and only checks webhook configuration. It does not poll emails. The existing `lastCheckedAt` API field now reports that successful configuration check for client compatibility. A quiet inbox remains healthy. Disabled/mismatched webhook settings, API failures, stale health checks, or unresolved ingestion failures suppress position estimates. Configuration health alone cannot detect a camera that stopped sending or a broken public reverse proxy.

There is no automatic historical backfill. Replay missed `email.received` events from Resend after the receiver is configured. Existing camera history remains intact; old IMAP cursor data is ignored. Old `IMAP_*` and `GOOGLE_*` environment settings are no longer used and can be removed.

## Trip settings

Predictions need no timetable. A map position needs the journey around the checkpoint, set together in `.env.server`:

- `TRIP_DURATION_SECONDS`: complete journey duration, 60 to 7200. One checkpoint can't measure this, so it must come from someone who knows the route.
- `TRIP_DIRECTION`: `inbound` (Fehren → campus) or `outbound` (campus → Fehren).
- `TRIP_CHECKPOINT_PROGRESS`: fraction of the route already covered at the camera, 0 to 1.

Leave `TRIP_DURATION_SECONDS` unset to predict only checkpoint passes. Restart the worker after changing them. A camera arrival before a variable stop or layover can't establish the departure that follows; leave the trip unset until the anchor is understood.

## API and history

`GET /api/shuttle` and the compatible `/api/detections/latest` return worker `status`, `lastCheckedAt`, `latest`, `eventCount`, and `prediction`. A prediction includes its model/schedule versions and generation time; active estimates include anchor type, range, estimated arrival time and a marker with direction, progress and lower/upper progress bounds. A missing marker means no usable position estimate. Worker states are connecting, connected, disconnected and sample. Prediction states include unconfigured, scheduled, estimated, ambiguous, unknown and offline. Ranges are labelled heuristic, not calibrated probabilities.

Production history and processed receipt IDs live in `.data/alerts.sqlite` on valley-big-mac and survive restart. On its first start the SQLite store imports `.data/alerts.json` once and leaves that file untouched. Sightings are only appended. Every distinct matching email is retained, including delayed/out-of-order arrivals. Message-ID retries are deduplicated; nearby separate emails have `duplicateOf` set, using a provisional 30-second grouping window. This can merge two nearby buses; raw history remains available to revise grouping. No email body/attachment is stored in history. No public history endpoint is exposed.

Each new sighting records the code that produced it: `BUSTRACKR_COMMIT` (null when unset), a 16-character hash of the worker's non-test `server/*.mjs` files, and the parser label `PARSER` from `server/alerts.mjs`. Bump that label when matching or timestamp rules change. The source hash changes with any worker edit, so it identifies hand-copied deployments too. Each sighting also stores the email's Message-ID and a SHA-256 of the text body the parser read, so a later parser can be checked against the same input. Sightings imported from JSON have no collector.

With `SIGHTINGS_UMAMI_URL` and `SIGHTINGS_UMAMI_WEBSITE` set, the worker mirrors every sighting to that Umami website as a `camera_sighting` event dated at the camera time. Event properties are `checkpoint`, `duplicate`, `delaySeconds` (camera to Resend), `commit`, `source` and `parser`. Production sends to the loopback collector, `http://127.0.0.1:18789`, and the "BusTrackr camera sightings" website (`e8d12380-7082-43d8-b6f3-81c39539802c`) at https://analytics.valleychristianai.com. Unsent sightings are retried every minute, so the first start after the import backfills the history. The dashboard is a view; the SQLite file is the record.

Export local event history as JSON lines:

```sh
npm run --silent alerts:export > .data/camera-events.jsonl
```

Each line includes `collector`, `input` and `dashboardSentAt`. Set `ALERT_STATE_FILE` explicitly to export another history. Legacy latest-only state is migrated into history on import; records without a camera event time are preserved but excluded from estimation.

## Verify and host

`npm run test:alerts` covers timestamp parsing, HTML email, filtering, persistent history, duplicates, schedule estimation, ambiguity, DST, delayed delivery, signed webhook delivery, recipient/authentication filtering, concurrent duplicates, retryable failures and the real sample HTTP server. `npm run build` checks the frontend and scene assets. Live delivery requires the configured Resend account, a reachable HTTPS webhook and a genuine camera message.

If self-hosting the standalone worker instead of using the deployed Mac backend, use an always-on host with persistent storage and backups. Its default bind is loopback; place a TLS reverse proxy in front. Configure an exact `ALERT_ALLOWED_ORIGIN` for a separately hosted frontend. CORS is not authentication: the status API is public, so add deployment access controls if operational status should be private. API responses contain no-store headers. Feed failure hides estimated positions while retaining the timestamped last observation. The SQLite store expects one worker process.

See [arrival estimation research and design decisions](arrival-estimation-research.md) for the evidence, assumptions, ML upgrade path and traffic-provider restrictions.

Resend references: [signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests) and [received-email retrieval](https://resend.com/docs/api-reference/emails/retrieve-received-email).

## Verified camera delivery

On November 1, the October 30 camera alert was recovered after fixing optional terminal punctuation and verifying Gmail forwarding through ARC. Its camera timestamp is `2026-10-30T21:35:43.000Z` (2:35:43 PM PDT), received at `2026-10-30T21:35:52.334Z`. Only the already-ignored receipt for that email was replayed; other history was preserved. Production state was backed up before replay. No synthetic sighting was inserted.

## Product website

The same worker serves the product website at `https://bustrackr.valleychristianai.com/`. `/api/*` remains reserved for backend requests. Website source is in `website/`; the static handler only serves public web file types and rejects hidden files and symlinks escaping that directory.

Deploy the website and map with the [atomic release controller](website-deployment.md). It validates a separate release, retains versioned assets, switches the website root atomically, and rolls back if public checks fail. Website updates must not restart the camera worker, frontend, or Cloudflare tunnel. Do not copy files over a live release. Backend upgrades remain separate because camera and notification state have one writer.

Keep credentials, history, and logs outside every website release. Verify both public hostnames, the map, and `/api/health` after deployment.

## SSH connection reliability

The local `valley-big-mac` SSH entry uses `IPQoS none`, a 30-second connection timeout, and automatic connection reuse (`ControlMaster auto`, `ControlPersist 600`, `ControlPath ~/.ssh/cm-%C`). These settings restored responsive access during the November 1 deployment. Authentication and host-key verification remain enabled. The previous SSH configuration was backed up locally before editing. If a tunnel is slow, reuse an authenticated connection rather than opening many parallel SSH handshakes.

The server logs subsequently identified repeated QUIC edge timeouts. The November 1 configuration used `protocol: http2` (TCP) for BusTrackr and SSH. On November 2 the global HTTP/2 BusTrackr connections failed, while a US-region QUIC connector restored public access. BusTrackr now uses `protocol: quic`, `region: us`, and IPv4; SSH retains its separate HTTP/2 configuration. SSH has a dedicated tunnel, `vcs-ssh` (`47e0adb0-6073-404f-88f8-359a1ea0adb0`), and LaunchAgent `com.cloudflare.vcs-ssh`, rather than sharing the older `vcs-mac-studio` tunnel. Its ingress is `ssh://127.0.0.1:22`; the existing Cloudflare Access login and SSH key checks still apply. The old shared tunnel and its other service routes were left running. Manifests are in `deploy/vcs-ssh.yml` and `deploy/com.cloudflare.vcs-ssh.plist`. Credentials remain only on the Mac.

Rollback, if ever needed: route `ssh.valleychristianai.com` back to tunnel `393fc0ab-4a84-460e-9734-adfbe53c6929` from the Mac using its original Cloudflare configuration. Do not stop the dedicated SSH tunnel until the replacement route is verified.

Website CSS and JavaScript use content-hashed filenames. After editing `website/style.css` or `website/site.js`, run `npm run website:prepare` and commit the generated files and updated HTML together. Upload assets before HTML. Keep previously deployed hashed assets available for clients with older documents. HTML is served with `no-store`; versioned assets can be cached immutably without mixing releases.

## Website analytics

The website uses the school-hosted Umami instance at `https://analytics.valleychristianai.com` on SSH host `valley-big-mac`. Its collector and PostgreSQL database run on that host. Its BusTrackr website ID is `5eaf2f91-0cd8-48ce-84b1-1cc3244cf436`. The public website ID is safe to include in HTML. Keep dashboard credentials on the analytics host.

The three HTML pages in `website/` include the tracker. The root React entry HTML includes the same tracker when built into the self-hosted `/` map. The tracker restricts collection to the production domains, retains query parameters for UTM attribution, and excludes URL hashes. Local development does not send pageviews. The native apps have no analytics SDK.

Run `node scripts/check-analytics.mjs` to verify an accepted browser pageview from the landing page with a unique verification campaign. Pass a URL as the first argument to check another deployment or page. The check fails if the pageview came from a different page, so it rejects `/app` for a signed-out browser, which is redirected to the landing page while the pilot is invite-only. The check uses a regular browser user agent because Umami filters headless browser traffic as bots. Confirm the campaign appears in Umami as well. An HTTP 200 response alone does not prove that Umami stored an event.

The Instagram story uses `utm_source=instagram&utm_campaign=simple-bryan-story`. Both public hostnames serve the website. The alias was added to the existing BusTrackr Cloudflare tunnel and DNS without changing the backend.
