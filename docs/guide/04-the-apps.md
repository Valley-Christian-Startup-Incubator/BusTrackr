# 4. The apps

Riders see BusTrackr through three clients: the web app at `/app`, the Expo app in `mobile/`, and push notifications. All of them read one endpoint, `GET /api/shuttle`, and all of them parse it with one zod schema, `feedSchema` in `mobile/src/shuttle/feed.ts`. The web app imports that file straight from the mobile folder, so the two clients can't drift apart on the contract.

## The feed

```json
{
  "status": "connected",
  "lastCheckedAt": "2026-11-09T22:40:12.000Z",
  "latest": {"checkpoint": "BEI campus corner", "eventAt": "2026-11-09T22:31:30.000Z", "receivedAt": "…"},
  "eventCount": 10,
  "prediction": {"model": "learned-runs-v1", "status": "scheduled", "nextCrossingAt": "…", "...": "…"}
}
```

`status` describes the worker's link to Resend. `lastCheckedAt` is the last time the worker confirmed its webhook configuration, which it does every 30 seconds (`RESEND_HEALTH_SECONDS`). `latest` is the newest observation. `prediction` is chapter 3's output.

The worker downgrades itself before anyone else has to. In `payload()`, if the last config check is more than 90 seconds old, or the receiver has unresolved failures, `status` becomes `disconnected`, the prediction becomes `offline`, and the marker is removed. The last observation stays. A real sighting from 20 minutes ago is still true. A position computed from a feed that might be missing emails isn't safe.

## Freshness, twice

The clients run their own freshness check on top. The web hook `src/useCameraFeed.ts` polls every 10 seconds with a 10-second timeout and calls the data fresh only when:

- the page is visible,
- the last fetch succeeded within 45 seconds,
- `lastCheckedAt` is between 30 seconds in the future and 120 seconds in the past,
- and `status` is `connected` or `sample`.

The 30 seconds of tolerance covers clock skew between a phone and the server. The mobile app uses the same numbers from `freshness` in `feed.ts`.

When the tab is hidden, polling stops. When it comes back, the hook forces a fresh fetch instead of trusting old data.

## Simple mode

Simple mode is the default, and it's the one most riders use. It shows a giant number: minutes since the last detection.

The number's color comes from `observationAge()` in `mobile/src/shuttle/observation.ts`, shared by both clients. It stays green while it reads under 10 minutes, then fades from amber to red by 20. (Commit `fabc092` exists only to keep it green until it reads 10. Riders noticed.)

A few edge cases have their own copy:

- A sighting from an earlier Pacific day reads "No Fehren bus detected yet today" and "Last seen yesterday at 3:12 PM", not "19 hours ago".
- A camera time in the future reads "Camera clock is ahead".
- A stale feed turns the number dark blue and says "Offline. A newer bus may have passed."

Simple mode has two report buttons. "The bus is here" logs an `arrived` report, meaning the camera missed a bus. "The bus isn't here" only appears within 30 minutes of a detection. Before it sends, it asks: "Were you already waiting?" A rider who shows up at 3:20 for a 3:12 bus and sees nothing hasn't found a false alarm. They missed the bus.

## Map mode

Map mode loads the 3D scene (chapter 5) lazily, so Simple riders never download it. Its camera panel offers "At Fehren" and "At campus" while the feed is current, and "Looks wrong" while an estimate is on screen. Only map reports carry a stop, which is why only they can teach trip lengths.

## Reports

`POST /api/feedback` takes `{id, verdict, view, stop, release}`. The browser generates `id` once per tap, so a retried request is stored once, even across worker restarts.

The worker appends each report as one line of JSON to `.data/alerts.json.feedback.jsonl` and never rewrites the file. It doesn't trust the client's copy of the prediction. It attaches its own `/api/shuttle` prediction from the moment the report arrived. That gives a direct error measurement: the rider says "here" at 3:21, the model said 3:19.

If the worker crashes mid-append, the last line is half written. On startup, `createFeedbackLog()` skips any line that won't parse and starts the next record on a new line.

Rate limit: 10 requests per minute per IP.

## Notifications

The "Notify me" button registers a Web Push subscription in the browser. The native app registers an Expo push token. The worker checks for new sightings every 5 seconds and sends "Fehren bus detected".

The rules are strict:

- Only sightings whose camera time **and** receipt time are both within the last 2 minutes. A sighting replayed from Resend an hour late never buzzes anyone's phone.
- Only sightings that happened after the subscription was created.
- Undelivered sends expire instead of going out late.
- Web Push endpoints must be on a known push service host (`fcm.googleapis.com`, `web.push.apple.com`, and a few more). The server won't POST to arbitrary URLs.

Unsubscribing needs a secret that only the subscribing device holds. The server stores a hash of it.

## The pilot gate

During the pilot, `/app` is invite-only. `src/pilotGate.ts` calls `GET /api/session` before rendering:

```ts
// Only a definite "signed out" sends a visitor away. If the worker is down, riders still get the map.
return (await fetchImpl(endpoint, …)).status === 401;
```

A 401 redirects to the landing page waitlist. A network error or a 503 renders the app anyway. The gate fails open on purpose.

That's fine because the gate isn't security. `/api/shuttle` is public with no auth at all. The gate keeps the audience small during the pilot. It doesn't protect data.

Sign-in uses one-time email links, no passwords (`server/accounts.mjs`):

- An operator runs `server/pilot.mjs approve <email>`. The invite link works once within 7 days.
- Later sign-ins at `/signin` get a link that works once within 15 minutes. Five link requests per 10 minutes per IP.
- Clicking the link marks the token used and creates the session in **one transaction**, so a double click yields one session.
- The session is a `bt_session` cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, 90 days.
- The database stores only SHA-256 hashes of tokens and sessions.

One known problem: some mail systems open every link to scan it, which uses up a one-time link before the human taps it. Student mail (`warriorlife.net`, Google Workspace) doesn't do this. Staff mail (`vcs.net`, through Proofpoint) can. The planned fix is a page with a Continue button.

## The native app

`mobile/` is an Expo app. The status cards, buttons, and settings are native React Native. The 3D map is a WebView. With no saved setting, the app connects to production. **Connection settings** can switch it to sample mode, which has an **Explore sample states** section that shows every status the UI can render.

---

## Grill session

**Q1.** The worker is up, but its Resend config check has been failing for two minutes. What does a rider in Simple mode see? What about Map mode?

<details><summary>Answer</summary>

`lastCheckedAt` is over 90 seconds old, so `payload()` reports `disconnected`. The web client sees a status other than `connected` or `sample` and marks the data not fresh. Simple mode still shows the last real detection, now in dark blue, with "Offline. A newer bus may have passed." Map mode has no marker because the prediction is `offline` with `marker: null`.

</details>

**Q2.** Valley's Wi-Fi blocks `/api/session` for an hour. Are pilot members locked out of `/app`?

<details><summary>Answer</summary>

No. `signedOut()` returns `true` only for an HTTP 401. A network error or timeout returns `false`, and the app renders. The gate fails open because it isn't protecting anything sensitive. `/api/shuttle` is public anyway.

</details>

**Q3.** Why does the worker attach its own prediction to a feedback report instead of trusting what the client showed?

<details><summary>Answer</summary>

The client could be stale, tampered with, or on an old release. The server's prediction at receipt time is a consistent record of what the model believed. Comparing that to the rider's report measures the model's error directly. The client sends its `release` string so you can still tell which web build was in use.

</details>

**Q4.** A rider arrives at the stop at 3:25. The camera reported a bus at 3:12. No bus is there. Should they tap "The bus isn't here"?

<details><summary>Answer</summary>

No, and the confirm dialog says so. They arrived after the detection, so the bus probably came and left. "False alarm" means the rider was already waiting **before** the detection time and no bus showed up. Mixing up the two would teach the system that real detections were fake.

</details>

**Q5.** Resend was down all morning. At 1 PM it replays a 9:14 AM camera email. Does anyone get a push notification?

<details><summary>Answer</summary>

No. A notification needs both the camera time and the receipt time within 2 minutes of now. The camera time is almost four hours old, so the sighting is history, not news. It still lands in SQLite and the estimator still learns from it.

</details>

**Q6.** Why does the web app import `feedSchema` from `../mobile/src/shuttle/feed` instead of keeping its own copy?

<details><summary>Answer</summary>

One schema means one contract. If the worker changes the feed shape, both clients fail validation the same way, and one test suite catches it. Two copies would let one client keep parsing an old shape until a rider hit the bug.

</details>

**Q7.** A staff member says their sign-in link "expired" the instant they tapped it. What happened?

<details><summary>Answer</summary>

Most likely Proofpoint, the `vcs.net` mail filter, opened the link to scan it. That first open used the one-time token. The fix in [`pilot.md`](../pilot.md) is to have the email link open a page with a Continue button, so only a human tap signs in.

</details>
