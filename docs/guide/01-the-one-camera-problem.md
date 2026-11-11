# 1. The one-camera problem

The Fehren ↔ Skyway shuttle carries students between the Fehren lot and the Valley Christian campus. Students waiting for it want one answer: is the bus coming, or did I miss it?

A normal transit app answers with GPS. BusTrackr can't. The bus has no tracker, and the school never supplied a timetable. The October 16 version of the estimator waited for an operator-confirmed timetable. It never arrived, so that version never made a single prediction.

What BusTrackr does have is an Avigilon security camera at the campus corner. When it sees a bus in its zone, it emails this:

```text
[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.
```

That one line is the only live input the whole system gets. Even the word "BEI" in it is unconfirmed. BEI is the school program that runs this project, but what the camera means by it, and where its zone sits, still needs the school to confirm.

## What one email proves, and what it doesn't

Read that email the way the code does, with suspicion.

It tells you:

- A camera claims something it classified as a bus entered its zone.
- The camera's clock said 2:06:43 PM Pacific when that happened.

It does **not** tell you:

- Which bus. There may be more than one.
- Which direction it was going. The zone may see both.
- That it was a bus at all. A delivery truck might count.
- That the camera's clock is right.
- Where the bus is now, or when it reaches the next stop.

Most of the design choices in this repo come from taking that second list seriously. The app never shows a position it can't defend. When the data is ambiguous, the app says "no clear run match" and shows nothing on the map. A blank map is better than a confident marker on the wrong road.

## Two kinds of truth, kept apart

The codebase draws a hard line between two things:

- An **observation** is something the camera reported. It has a timestamp and it happened.
- An **estimate** is something the model guessed from observations. It may be wrong.

The apps never blend them. Simple mode shows only the observation: "The last Fehren bus was detected 4 minutes ago." The map shows an estimate as an amber marker with an uncertainty band, labelled as an estimate. The API response keeps them in separate fields (`latest` and `prediction`).

The two never mix in storage either. Predictions are never saved as training data. If they were, the model would slowly learn from its own guesses.

## The words this codebase uses

[`CONTEXT.md`](../../CONTEXT.md) defines these. Use them exactly, in code, docs, and PRs.

| Term | Meaning |
| --- | --- |
| Camera event | One timestamped email saying a bus entered the zone. No identity, no direction. |
| Arrival | One physical bus visit. A single arrival can produce several camera events. |
| Learned run | A recurring pass the model found in history, seen on at least two days. It has a time of day, a spread, and a likelihood for each weekday. |
| Estimate | A prediction anchored to a learned run or a camera event. Never an observed position. |
| Service date | The calendar date in `America/Los_Angeles` on which a run is expected. |

"Camera event" and "sighting" mean the same thing in practice. The SQLite table is called `sightings`.

## What's in the repo

| Path | What it is |
| --- | --- |
| `server/` | The camera worker. One Node process that receives email webhooks, stores history, runs the estimator, and serves the API. Plain `.mjs` with no build step. |
| `src/` | The React web app. Simple mode plus the 3D map. |
| `src/local/`, `src/world.ts` | The Three.js campus scene. |
| `mobile/` | The Expo app for iOS and Android. |
| `website/` | The landing page, privacy page, support page, and sign-in page. Plain HTML. |
| `scripts/` | Asset builders, checks, and the website deploy controller. |
| `public/` | Scene data: terrain, building footprints, textures, the bus model. |
| `deploy/` | launchd plists and Cloudflare tunnel configs for the Mac. |

## Run it in two terminals

You don't need any credentials to see the whole thing work.

```sh
npm install
npm run alerts:sample
```

The sample worker writes four days of fake sightings at the same time of day, the last one two minutes ago. That gives the model enough history to learn a run. It also fakes rider reports eight minutes after each earlier sighting, so the model learns a trip length too.

In a second terminal:

```sh
npm run dev -- --port 4173 --strictPort
```

Open http://localhost:4173. The dev server proxies `/api` to the worker on port 8787.

---

## Grill session

**Q1.** A product manager asks for a "bus is 3 minutes away" banner on the home screen, computed from the latest camera email. What's wrong with building that directly from one camera event?

<details><summary>Answer</summary>

A camera event has no direction and no identity. "3 minutes away" needs to know where the bus is going and how long the trip takes. The camera sits at the campus corner, so a bus heading to campus has nearly arrived while a bus heading to Fehren has barely left. Without direction, the same email means two very different arrival times. BusTrackr only shows a position when today's sighting matches a learned run with a learned trip length, and it refuses when more than one could match.

</details>

**Q2.** Why does the codebase forbid storing the model's predictions next to the sightings?

<details><summary>Answer</summary>

Predictions must never become training labels. If a guess were stored like an observation, the next fit would learn from it, and errors would feed on themselves. Keeping events and estimates apart also means a new model can replace the old one without touching the history it learns from.

</details>

**Q3.** True or false: if Simple mode says "detected 4 minutes ago", the bus arrives in about 4 minutes.

<details><summary>Answer</summary>

False. Simple mode shows the time since the camera's last detection. It says nothing about arrival. The page states it below the number: "Time since camera detection, not an arrival estimate."

</details>

**Q4.** One arrival, three camera events. How is that possible, and which glossary terms does it use?

<details><summary>Answer</summary>

A bus that sits in the zone, moves a bit, or triggers the camera twice produces several **camera events** for one **arrival**. Chapter 2 shows how the worker groups events within 30 seconds of each other.

</details>

**Q5.** Why did the October 16 estimator never make a prediction?

<details><summary>Answer</summary>

It needed a timetable confirmed by an operator, and nobody ever confirmed one. The current model learns the pattern from sightings instead, because sightings are the only data that keeps arriving.

</details>
