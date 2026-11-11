# 7. Final boss

These questions cross chapters. Most have no single line of code as the answer. If you can answer all of them without opening the answers, you're ready to own this repo.

---

**Q1. Trace one bus.** It's Wednesday. At 3:12:30 PM the camera sees a bus. Riders taught the model a trip to Fehren on that run. Narrate everything that happens, from the camera to a rider's phone, until the bus reaches Fehren.

<details><summary>Answer</summary>

1. The camera emails `fehren@inbound.valleychristianai.com`. Resend receives it and POSTs a signed `email.received` webhook through the Cloudflare tunnel to the frontend, which proxies it to the worker.
2. The worker verifies the Svix signature, checks the recipient, checks the `receipts` table, fetches the email from the Resend API, checks DKIM or DMARC, and runs `parseAlert()`.
3. `history.record()` appends the sighting and its receipt in one transaction. It isn't within 30 seconds of another sighting, so it has no `duplicateOf`. The worker returns 200 and saves a snapshot if today's doesn't exist yet.
4. Within 5 seconds, the notification tick sees a sighting whose camera time and receipt time are both under 2 minutes old. It queues a "Fehren bus detected" push for every subscription created before 3:12:30.
5. A rider's app polls `/api/shuttle` within 10 seconds. `estimate()` refits, matches the sighting to `run-1512`, finds the Fehren trip, and returns `estimated` with a marker starting near 5% progress.
6. Simple mode shows "<1 minute ago" in green. Map mode shows the amber marker moving toward Fehren with its uncertainty band, refreshed every poll.
7. When `now` passes sighting + trip length, the pass is no longer active. The response falls back to `scheduled` for the next learned pass, and the marker disappears.
8. A rider at Fehren taps "At Fehren". That report becomes one more vote for the trip length, with the server's prediction attached for scoring.

</details>

**Q2. The scariest failure.** Name the single failure that would lose the most data that can't be recovered, and what would prevent it.

<details><summary>Answer</summary>

Losing the Mac's disk. `.data/alerts.sqlite`, its 14 daily snapshots, the feedback log, the accounts database, and the notification state all sit on that one machine. There's no off-machine backup. Camera history is hard to rebuild, because Resend has no automatic historical backfill. The fix is an off-machine copy of the daily snapshots plus a tested restore drill, which `release-readiness.md` already lists.

</details>

**Q3. The tempting shortcut.** Someone proposes: "Instead of learning runs, let's just predict the next bus as last sighting + the average gap between sightings." Give two concrete reasons that fails on this data.

<details><summary>Answer</summary>

- The gaps span nights, weekends, and holidays. The average gap between sightings is dominated by the 20-hour overnight gap, so the prediction is useless during the day.
- It has no notion of weekdays. Production runs differ by day (2:31 PM on Tue/Fri, 3:12 PM on Mon/Wed/Thu). One average blends them into a time when no bus runs.

A third reason: one stray trigger shifts the average. The learned-runs model drops a group seen on only one day and uses medians.

</details>

**Q4. Is the API a leak?** `/api/shuttle` is public with no auth. During the pilot, `/app` requires sign-in. A school administrator asks whether that's a security hole. What do you tell them?

<details><summary>Answer</summary>

It's deliberate and documented in `pilot.md`. The feed contains the time of the last bus detection and a predicted next pass. It contains no student data, no email content, and no camera images. The pilot gate keeps the audience small while the product is tested. It doesn't protect the data, and it isn't meant to. If the bus schedule itself had to be private, the API would need real access control. CORS doesn't count, and `camera-alerts.md` says so.

</details>

**Q5. Clock trouble.** The camera's clock drifts 6 minutes fast. List every place in the system that notices, and what each does.

<details><summary>Answer</summary>

- `parseAlert()` rejects any email whose camera time is more than 5 minutes after Resend's receive time. At 6 minutes fast, every alert is dropped. The webhook still returns 200, so nothing retries. The feed just goes quiet.
- If the drift were under 5 minutes, the sighting would be stored. `sightingsAt()` would exclude it until real time caught up with the camera time.
- The clients' `observationAge()` would show "Camera clock is ahead" while the camera time is in the future.
- Notifications skip events whose camera time is in the future.

So a fast clock looks like "the camera stopped sending". `eventCount` stops rising while the Resend Receiving tab still shows emails. That gap is how you'd spot it.

</details>

**Q6. Two buses.** The school adds a second shuttle on the same route, running 30 seconds behind the first. What breaks, in order of how quietly it breaks?

<details><summary>Answer</summary>

1. Quietest: the 30-second cooldown marks the second bus as `duplicateOf` the first. The estimator and notifications never see it. Nothing errors.
2. If they're more than 30 seconds apart, two sightings match one learned pass. `estimate()` sees `observed.length > 1` and returns `ambiguous`. The map goes blank with "No clear run match". That's correct behavior, but riders lose positions.
3. Trip learning pairs each rider report with the latest earlier sighting, so reports for the first bus can pair with the second bus's sighting and shorten the learned trip.

Raw rows are kept, so grouping can be redone once the camera supplies a vehicle ID or a second checkpoint exists.

</details>

**Q7. Your first PR.** You want to change `settings.gapMinutes` from 20 to 15. What do you run, what do you compare, and what goes in the PR description?

<details><summary>Answer</summary>

Run `npm run model:report` on a copy of production history before and after the change. Compare runs found, noise count, hits, misses, false alarms, mean error, and window coverage. Run `npm run test:alerts` so the estimator tests still pass. The PR description states the before and after backtest numbers and how many days they cover. With this little data, admit that the result might be noise. The baseline to beat is 2 hits and 3 misses over 5 days. Every feedback report records the model's `quality` at that moment, so rider reports after the deploy measure the change in production too.

</details>

**Q8. Spot the lie.** Which of these statements is false?

1. Deleting a pilot member signs them out of every device.
2. A webhook returning HTTP 200 proves a bus sighting was stored.
3. The native app's 3D map loads with no network connection.
4. The estimator never returns `offline`.

<details><summary>Answer</summary>

Statement 2 is false. The worker returns 200 for ignored mail, duplicate receipts, and emails that fail the parser. The only proof is `eventCount` rising and `latest` showing the camera's timestamp on `/api/shuttle`.

1 is true (`remove` deletes sessions in the same transaction). 3 is true (everything is inlined as data URIs). 4 is true (`payload()` in `server/index.mjs` sets `offline`, not `estimate()`).

</details>

---

Done? Go read [`arrival-estimation-research.md`](../arrival-estimation-research.md) end to end. Then pick one item from [`release-readiness.md`](../release-readiness.md) and ship it.
