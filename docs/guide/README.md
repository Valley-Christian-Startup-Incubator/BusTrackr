# The BusTrackr field guide

BusTrackr tells Valley Christian students when the Fehren shuttle went by. It has no GPS on the bus and no timetable from the school. It has one security camera on a campus corner that sends an email whenever it sees a bus.

Everything in this repo turns those emails into something a rider can use, and says plainly what the emails can't tell you.

This guide is for the next person who owns this code. Read it in order. Each chapter ends with a **grill session**: questions that check whether you understood the chapter or only skimmed it. The answers are folded away. Try each question before you open its answer. Some of them are mean on purpose.

## The whole system on one screen

```text
 Avigilon camera at the campus corner
        │  "[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived."
        ▼
 Resend inbound address ──webhook──▶ camera worker (server/index.mjs, port 18787)
                                       │  verify signature, sender, DKIM/DMARC or ARC
                                       │  parse timestamp, dedupe
                                       ▼
                                     .data/alerts.sqlite (append-only sighting history)
                                       │
                                       │  every GET /api/shuttle refits the model
                                       ▼
                                     server/estimator.mjs  ◀── rider "the bus is here" reports
                                       │
             ┌─────────────────────────┼──────────────────────────┐
             ▼                         ▼                          ▼
   web app at /app            Expo app in mobile/          push notifications
   (Simple + 3D Map)          (native cards + 3D WebView)  (Web Push, Expo push)
```

Cloudflare Tunnel puts all of this on `https://bustrackr.valleychristianai.com`. The whole backend runs on one Mac in a classroom, called `valley-big-mac`.

## Chapters

1. [The one-camera problem](01-the-one-camera-problem.md). What the product is, what a camera email proves, and the words this codebase uses.
2. [From email to sighting](02-from-email-to-sighting.md). How a camera email becomes a row in SQLite, and every check it has to pass on the way.
3. [Predicting a bus nobody scheduled](03-predicting-the-bus.md). The `learned-runs-v1` model, its self-grading backtest, and how riders teach it trip lengths.
4. [The apps](04-the-apps.md). The web app, the native app, freshness rules, and the pilot sign-in gate.
5. [The 3D campus](05-the-3d-campus.md). A hand-built Three.js reconstruction of the route, and how it fits inside a phone app.
6. [Shipping it](06-shipping-it.md). CI, the website deploy controller, the worker deploy, and the Mac it all runs on.
7. [Final boss](07-final-boss.md). Questions that cut across every chapter.

## Where the reference docs live

This guide explains. The files in [`docs/`](../) are the reference and runbooks, and they win when the two disagree. The ones you'll open most:

- [`arrival-estimation-research.md`](../arrival-estimation-research.md) for the model's design and its upgrade path.
- [`camera-alerts.md`](../camera-alerts.md) for worker setup and operations.
- [`website-deployment.md`](../website-deployment.md) for the deploy controller.
- [`pilot.md`](../pilot.md) for letting people in.
- [`/CONTEXT.md`](../../CONTEXT.md) for the glossary.
