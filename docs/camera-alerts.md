# Camera alert setup

The camera sends alerts to a Resend receiving address. Node 22+ runs a signed inbound-email webhook and status API; GitHub Pages serves only the frontend. Gmail/IMAP polling has been removed.

## Local sample

```sh
npm install
npm run alerts:sample
# In another terminal
npm run dev -- --port 4173 --strictPort
```

Open http://localhost:4173. Camera estimates is the default mode. The sample parses an Avigilon-format fixture with a recent synthetic event time, stores it in `.data/sample-alerts.json`, and uses an explicitly illustrative schedule. The amber map marker and route band show estimated progress; Scene demo switches back to the simulated fleet. A sample event is created only for an empty sample state. After its journey ends the marker disappears; use a new `ALERT_STATE_FILE` for a fresh demo.

The dev server proxies `/api` to port 8787. Production requires `VITE_ALERT_API_URL` pointing to the worker's HTTPS `/api/shuttle` endpoint at frontend build time. `.env.example` documents this public setting. Without it, production shows a configuration notice and hides estimates.

## Hosted backend setup

The backend is already deployed in [Vercel's bustrackr-api project](https://vercel.com/thatxliners-projects/bustrackr-api), with a connected private Blob store. You do not need another server.

| Purpose | URL |
| --- | --- |
| Resend webhook (POST) | `https://bustrackr-api.vercel.app/api/resend/inbound` |
| Health (GET) | `https://bustrackr-api.vercel.app/api/health` |
| App status feed (GET) | `https://bustrackr-api.vercel.app/api/shuttle` |

### 1. Choose the receiving address

In the **new Resend account**, open **Emails → Receiving**, then the three-dot menu → **Receiving address** to find the account's `<id>.resend.app` domain. Choose `camera@<id>.resend.app`. This route does not require your own DNS changes. Alternatively, enable receiving on a dedicated custom subdomain and add the MX records Resend supplies; wait for verification. Do not replace an existing normal-mail domain's MX records. See [Resend receiving setup](https://resend.com/docs/dashboard/receiving/introduction).

### 2. Create the webhook and API key

In Resend's **Webhooks** page, add the exact URL above, subscribe to **`email.received`**, and leave the webhook enabled. Save its **ID** and **signing secret** (`whsec_...`). The ID is not the signing secret or a delivered event's ID. Create an API key in this same account that can read received emails and webhook configuration; a sending-only key cannot run this backend. See [Resend webhook setup](https://resend.com/docs/webhooks/introduction).

### 3. Configure Production on Vercel

Open [Settings → Environment Variables](https://vercel.com/thatxliners-projects/bustrackr-api/settings/environment-variables). Select **Production** and add these four values:

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | New account's API key; store as a secret |
| `RESEND_WEBHOOK_SECRET` | New webhook's `whsec_...` signing secret; store as a secret |
| `RESEND_WEBHOOK_ID` | New webhook's ID |
| `RESEND_INBOUND_ADDRESS` | Exact camera recipient chosen in step 1 |

The complete template is [hosting/.env.example](../hosting/.env.example). `RESEND_WEBHOOK_URL`, `CAMERA_SENDER=avigilonalerts@vcs.net`, and `CAMERA_MARKER=BEI Bus has arrived.` are already set in Production. Change the sender or marker if actual alerts differ. `CAMERA_SUBJECT` is optional. The connected store manages `BLOB_READ_WRITE_TOKEN`; do not overwrite it with a blank value.

For the GitHub Pages web frontend, also set `ALERT_ALLOWED_ORIGIN=https://thatxliner.github.io` (an origin has no `/BusTrackr/` path). Native apps do not require CORS.

After saving variables, open **Deployments**, select the latest production deployment, and **Redeploy**. Saving a local `.env` file or changing dashboard variables alone does not update an existing deployment.

### 4. Point the camera at Resend and verify

Set the camera's alert recipient to exactly `RESEND_INBOUND_ADDRESS`. Keep its existing sending/SMTP settings; Resend is receiving these messages. Direct delivery is preferred. A forwarded message must preserve the required sender and pass the backend's authentication checks.

Open the health URL. Expected result: `status: "connected"`, `storage: "connected"`, and `missing: []`. Before configuration, health reports `needs_configuration` and the webhook returns HTTP 503. A configured but unsigned POST is rejected with HTTP 400. Opening the POST webhook in a browser is not a delivery test.

Trigger a genuine camera alert. Confirm it appears in Resend's Receiving tab and its `email.received` webhook delivery returns HTTP 200. Then open the app status URL: `latest` must contain the actual camera timestamp and `eventCount` must increase. HTTP 200 alone does not prove an alert was stored: unrelated or filtered messages are acknowledged but ignored. The message must match the sender and recipient, have DKIM or DMARC `pass`, and contain the configured marker with a valid timestamp such as `[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.` using the actual event time.

Replay failed deliveries from Resend after correcting configuration. There is no automatic historical backfill. Check health for missing variables; for `disconnected`, check API permissions, webhook ID/URL/secret/subscription, and unresolved delivery failures. HTTP 503 after configuration indicates a retryable processing/storage failure.

### 5. Connect the clients

In the mobile app's **Connection settings**, enter `https://bustrackr-api.vercel.app/api/shuttle` and select **Connect to feed**. Or copy `mobile/.env.example` to `mobile/.env.local`, set `EXPO_PUBLIC_SHUTTLE_API_URL` to that URL, and restart/rebuild the app. A saved connection selection takes precedence.

For the web frontend, copy root `.env.example` to `.env.local`, set `VITE_ALERT_API_URL=https://bustrackr-api.vercel.app/api/shuttle`, and rebuild/redeploy the frontend. For CI builds, set the variable in that build environment. Both client variables are public; never put Resend credentials in them.

A working feed supplies observations. Position estimates also require the confirmed timetable described below; the checked-in schedule is intentionally empty and unconfirmed.

### Templates and redeployment

Commit the examples, never the filled-in files:

| Tracked template | Purpose | Local copy, if needed |
| --- | --- | --- |
| `hosting/.env.example` | Hosted backend variable reference | `hosting/.env.local` (does not configure Production) |
| `.env.server.example` | Standalone local Node worker | `.env.server` |
| `.env.example` | Public web frontend | `.env.local` |
| `mobile/.env.example` | Public native app | `mobile/.env.local` |

To deploy backend code or timetable changes from the repository root:

```sh
npm ci
node scripts/package-backend.mjs
npm ci --prefix hosting
npm run test:alerts
# On a fresh clone, link to the existing project first:
npx vercel@65.8.0 --scope thatxliners-projects --cwd hosting link --project bustrackr-api --yes
npx vercel@65.8.0 --scope thatxliners-projects --cwd hosting deploy --prod
```

The packaging script copies backend modules and the timetable into ignored `hosting/server/`. Edit the originals in `server/`. The deployment excludes local environment files and mobile/3D assets. Private Blob stores history, receipt IDs and pending failures across deployments; conditional writes protect concurrent updates. Local JSON state is separate and is not uploaded automatically.

## Standalone local worker (optional)

For a local live receiver, copy `.env.server.example` to `.env.server` and fill in the Resend variables. Its webhook URL must point to a public HTTPS reverse proxy or tunnel reaching this local worker, with a corresponding Resend webhook ID and secret. The hosted URL continues to route to Vercel, not your laptop.

```sh
npm run alerts:check
npm run alerts
```

The check verifies webhook configuration, not camera delivery. The sample mode above needs no credentials. Local `RESEND_HEALTH_SECONDS=30` controls configuration checks only; the cloud handler checks configuration on status requests.

## Processing behavior

Incoming requests use raw-body Svix signature verification with timestamp tolerance. Only events for `RESEND_INBOUND_ADDRESS` trigger an email-content fetch. The fetched email must also match that recipient and have Resend-computed DKIM or DMARC `pass`; missing or failed authentication is ignored. The existing parser then requires the configured sender and marker and a valid Pacific camera timestamp. No emails are sent, moved, or deleted.

The receiver acknowledges duplicates and irrelevant mail with HTTP 200. API or persistence failures return 503 so Resend retries. Writes are acknowledged only after persistence; the local worker serializes writes and the hosted backend uses conditional updates. Retry IDs survive restarts. Bodies are fetched and parsed transiently. Attachments are never downloaded or stored. Only parsed event metadata, receipt IDs, and pending delivery IDs are persisted. Responses are limited to 2 MB and webhook bodies to 64 KB.

`RESEND_HEALTH_SECONDS` defaults to 30 and only checks webhook configuration. It does not poll emails. The existing `lastCheckedAt` API field now reports that successful configuration check for client compatibility. A quiet inbox remains healthy. Disabled/mismatched webhook settings, API failures, stale health checks, or unresolved ingestion failures suppress position estimates. Configuration health alone cannot detect a camera that stopped sending or a broken public reverse proxy.

There is no automatic historical backfill. Replay missed `email.received` events from Resend after the receiver is configured. Existing camera history remains intact; old IMAP cursor data is ignored. Old `IMAP_*` and `GOOGLE_*` environment settings are no longer used and can be removed.

## Configure a real timetable

`server/schedule.json` deliberately starts with `confirmed:false` and no runs. Copy the structure of `server/schedule.example.json`, replace every illustrative value with confirmed service details, then set `confirmed:true`. Repackage and redeploy the hosted backend after changes, or restart a local worker. Required values per run:

- A unique stable run ID and operating weekdays (0 Sunday through 6 Saturday).
- Scheduled checkpoint crossing time in America/Los_Angeles, as `HH:mm`.
- Checkpoint name exactly matching the camera configuration.
- `direction`: inbound means Fehren → campus; outbound means campus → Fehren.
- `durationSeconds`: assumed complete journey duration, not a value learned from one checkpoint.
- `checkpointProgress`: fraction of distance along that direction's route, from 0 to 1.

Use `excludedDates` for known school holidays and `matchWindowSeconds` to tune association (default 900). Runs are dated by their checkpoint crossing date; overnight service is not supported. A camera arrival before a variable stop/layover cannot establish subsequent departure; leave estimates disabled until the intended anchor is confirmed.

## API and history

`GET /api/shuttle` and the compatible `/api/detections/latest` return worker `status`, `lastCheckedAt`, `latest`, `eventCount`, and `prediction`. A prediction includes its model/schedule versions and generation time; active estimates include anchor type, range, estimated arrival time and a marker with direction, progress and lower/upper progress bounds. A missing marker means no usable position estimate. Worker states are connecting, connected, disconnected and sample. Prediction states include unconfigured, scheduled, estimated, ambiguous, unknown and offline. Ranges are labelled heuristic, not calibrated probabilities.

Hosted history and processed receipt IDs live in private Blob storage. The standalone worker stores them in `.data/alerts.json`; both survive restart. Every distinct matching email is retained, including delayed/out-of-order arrivals. Message-ID retries are deduplicated; nearby separate emails have `duplicateOf` set, using a provisional 30-second grouping window. This can merge two nearby buses; raw history remains available to revise grouping. No email body/attachment is stored in history. No public history endpoint is exposed.

Export local event history as JSON lines:

```sh
npm run --silent alerts:export > .data/camera-events.jsonl
```

Set `ALERT_STATE_FILE` explicitly to export another state file. Legacy latest-only state is migrated into history on load; records without a camera event time are preserved but excluded from estimation.

## Verify and host

`npm run test:alerts` covers timestamp parsing, HTML email, filtering, persistent history, duplicates, schedule estimation, ambiguity, DST, delayed delivery, signed webhook delivery, recipient/authentication filtering, concurrent duplicates, retryable failures and the real sample HTTP server. `npm run build` checks the frontend and scene assets. Live delivery requires the new Resend account, a reachable HTTPS webhook and a genuine camera message.

If self-hosting the standalone worker instead of using the deployed Vercel backend, use an always-on host with persistent storage and backups. Its default bind is loopback; place a TLS reverse proxy in front. Configure an exact `ALERT_ALLOWED_ORIGIN` for a separately hosted frontend. CORS is not authentication: the status API is public, so add deployment access controls if operational status should be private. API responses contain no-store headers. Feed failure hides estimated positions while retaining the timestamped last observation. The JSON store requires a single writer; move to a transactional database when scale or multiple workers require it.

See [arrival estimation research and design decisions](arrival-estimation-research.md) for the evidence, assumptions, ML upgrade path and traffic-provider restrictions.

Resend references: [signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests) and [received-email retrieval](https://resend.com/docs/api-reference/emails/retrieve-received-email).
