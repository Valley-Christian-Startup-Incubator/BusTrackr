# 2. From email to sighting

A camera email travels through six checks before it becomes a row in `.data/alerts.sqlite`. Each check exists because something went wrong or could go wrong. This chapter follows one email through the worker.

## The route

```text
camera ──email──▶ fehren@inbound.valleychristianai.com (Resend)
                     │
                     │ POST /api/resend/inbound  (Svix-signed webhook, body ≤ 64 KB)
                     ▼
              server/index.mjs ──▶ createReceiver().handle()      server/resend.mjs
                     │ 1. verify the Svix signature
                     │ 2. is it email.received, for our address?
                     │ 3. already processed this email ID?          receipts table
                     │ 4. fetch the email from the Resend API
                     │ 5. DKIM/DMARC pass, or a verified Google ARC chain
                     ▼
              parseAlert()                                         server/alerts.mjs
                     │ 6. right sender, right marker, valid Pacific timestamp
                     ▼
              history.record()                                     server/history.mjs
                       append to sightings, mark duplicates
```

Gmail polling over IMAP used to do this job. It's gone. The webhook replaced it, and the old `IMAP_*` settings do nothing now.

## Check 1. The webhook is really from Resend

Anyone on the internet can POST to `/api/resend/inbound`. The worker reads the raw body (capped at 64 KB) and checks its Svix signature against `RESEND_WEBHOOK_SECRET`. A bad signature gets HTTP 400 and nothing else happens.

The webhook body only says "email X arrived for address Y". It doesn't contain the email. That matters for the next steps.

## Check 2. It's for us

The event must be `email.received` and addressed to one of the comma-separated addresses in `RESEND_INBOUND_ADDRESS`. Anything else gets **HTTP 200 with `ignored: true`**.

Why 200 for junk? Resend retries anything that isn't a 2xx. If the worker answered spam with an error, Resend would retry that spam forever. The worker saves error codes for failures it wants retried.

## Check 3. Have we seen this email?

The `receipts` table stores every Resend email ID the worker has finished processing. A retry of an email already processed returns `{duplicate: true}` right away. Receipts live in SQLite, so they survive restarts.

## Check 4. Fetch the real email

The worker calls `GET /emails/receiving/<id>` on the Resend API. Responses are capped at 2 MB, time out after 15 seconds, and refuse redirects.

The receiver runs one email at a time through a promise queue. If 32 are already waiting, it answers 503 and lets Resend retry later. If processing throws (the API is down, the disk is full), the email ID goes into a `failures` set and the response is 503. While that set is non-empty, the receiver reports itself unhealthy, and the API stops showing position estimates. Chapter 4 explains why.

## Check 5. The email is authentic

The `From:` header is trivial to fake, so the sender address alone proves nothing. The worker accepts an email if Resend says DKIM or DMARC passed.

There's one exception, and it has a story. On October 30 a real camera alert reached the worker through Gmail forwarding. Forwarding breaks the DKIM signature in a way that fails Resend's check, so the worker ignored a genuine bus. The fix lives in `server/forwarded-auth.mjs`. When DKIM and DMARC both fail but the sender matches, the worker:

1. downloads the raw message, but only over HTTPS and only from `cdn.resend.app`,
2. verifies its ARC chain cryptographically with `mailauth`,
3. accepts it only if Google signed the chain, `mx.google.com` recorded the original results, and the original DMARC passed for the camera sender's domain.

Unverified forwarding headers are never trusted. The October 30 alert was replayed on November 1 and is in production history now.

## Check 6. The parser

`parseAlert()` in `server/alerts.mjs` rejects the email unless all of these hold:

- There is exactly one sender, and it equals `CAMERA_SENDER` (case-insensitive).
- The subject contains `CAMERA_SUBJECT`, if one is set.
- The text contains `CAMERA_MARKER`.
- The body has a timestamp that `cameraTimestamp()` accepts.
- The camera time is no more than 5 minutes after the time Resend received the email.

`cameraTimestamp()` deserves a close look. It parses `[2026-Oct-16 02:06:43 PM (PDT)]`, converts it to UTC using the zone label, and then **formats the result back** into Pacific time. If the round trip doesn't reproduce the exact year, month, day, hour, minute, second, and zone label, it returns `null`. That one trick rejects February 30th, a "PST" label in July, and a time that doesn't exist on the night clocks spring forward.

The parser also records provenance. Each sighting stores the Message-ID and a SHA-256 of the body text the parser read. If a later parser version disagrees with an old one, you can check both against the same input. When you change the matching or timestamp rules, bump `PARSER` in `server/alerts.mjs` (currently `camera-email-v1`).

## Storing it

`history.record()` appends the sighting inside a SQLite transaction, together with the receipt. Both are written or neither is. The receiver answers 200 only after the write commits.

Then comes grouping. If another sighting at the same checkpoint has a camera time within `CAMERA_COOLDOWN_SECONDS` (default 30) of this one, the new row gets `duplicateOf` set to that sighting's ID. The row is still stored. The estimator and notifications skip rows with `duplicateOf`.

Why store a duplicate at all? Because the 30-second window is a guess. Two buses could pass within 30 seconds of each other and get merged. Keeping every raw row means a better grouping rule can be applied later without losing data.

Each sighting also records which code produced it:

| Column | Holds |
| --- | --- |
| `collector_commit` | `BUSTRACKR_COMMIT`, set by `scripts/deploy-worker.sh` |
| `collector_source` | A 16-character hash of every non-test `server/*.mjs` file, so even a hand-copied deploy is identifiable |
| `parser` | The `PARSER` label |

## Keeping it

The history is append-only. No code path updates or deletes a sighting, except `dashboard_sent_at`, which marks rows mirrored to Umami.

Every minute, `maintainHistory()` does two jobs:

- It writes a daily snapshot with `VACUUM INTO` to `.data/backups/sightings-YYYY-MM-DD.sqlite` and keeps the newest 14.
- If `SIGHTINGS_UMAMI_URL` is set, it mirrors new sightings to the self-hosted Umami dashboard as `camera_sighting` events. The dashboard is a view. SQLite is the record.

Before SQLite, history lived in `.data/alerts.json`. On first start, `openHistory()` imports that file once, records the import in a `meta` table, and leaves the JSON file untouched.

The snapshots sit on the same disk as the database. No off-machine backup exists yet.

---

## Grill session

**Q1.** A spammer finds the webhook URL and POSTs a well-formed `email.received` event with a fake signature. What status do they get, and does the worker call the Resend API?

<details><summary>Answer</summary>

HTTP 400, "Invalid webhook signature". The Svix check runs first, so the worker never fetches anything.

</details>

**Q2.** Now a real, correctly signed webhook arrives for a newsletter sent to the camera address. What status does the worker return, and why that one?

<details><summary>Answer</summary>

HTTP 200. The email fails the sender or marker check, so `parseAlert()` returns `null` and nothing is stored, but the receipt is still recorded. The worker answers 200 for anything it chose to ignore, so Resend stops retrying it. Error codes are reserved for failures that a retry could fix. Note that a 200 from the webhook does **not** prove a bus was stored. Check `eventCount` on `/api/shuttle`.

</details>

**Q3.** What does `cameraTimestamp()` return for this body, and why?

```text
[2026-Jul-04 02:06:43 PM (PST)] BEI Bus has arrived.
```

<details><summary>Answer</summary>

`null`. The code reads "PST" and adds 8 hours, giving 22:06:43 UTC. Formatting that back to Pacific time in July gives 3:06:43 PM **PDT**. The hour and the zone label don't match the input, so the round-trip check rejects it. Los Angeles is on daylight time in July, so a "PST" stamp can't be a real summer reading.

</details>

**Q4.** Two emails arrive with camera times 2:06:43 PM and 2:07:05 PM at the same checkpoint. How many rows land in `sightings`, and how many does the estimator use?

<details><summary>Answer</summary>

Two rows. They are 22 seconds apart, inside the 30-second window, so the second gets `duplicateOf` pointing at the first. The estimator uses one. The raw row stays so the grouping rule can change later.

</details>

**Q5.** The Resend API times out while the worker fetches an email. Walk through what the rider sees and what eventually fixes it.

<details><summary>Answer</summary>

The receiver adds the email ID to its `failures` set and answers 503. With a non-empty `failures` set the receiver is unhealthy, so `payload()` reports the feed as `disconnected`, the prediction becomes `offline`, and the map marker disappears. The rider still sees the last real observation. Resend retries the webhook, the fetch succeeds, the ID leaves `failures`, and estimates come back.

</details>

**Q6.** You change the regex in `cameraTimestamp()` to accept a missing period at the end. What else must you change in the same commit, and why?

<details><summary>Answer</summary>

Bump `PARSER` in `server/alerts.mjs`. Every new sighting records the parser label, so you can later tell which rows were parsed under which rules. The source hash would change anyway, but the label is the explicit signal that parsing behavior changed. (This exact change happened. Optional terminal punctuation was part of the October 30 fix.)

</details>

**Q7.** Why does a forwarded email's raw download get refused if the URL is `https://cdn.resend.app:8443/...`?

<details><summary>Answer</summary>

`receivedAlert()` accepts the raw URL only if it's HTTPS on host `cdn.resend.app` with no port, username, or password. The URL comes from API data, so the worker pins it to the one host it expects. That stops the worker from fetching an arbitrary URL on someone else's behalf.

</details>
