# 3. Predicting a bus nobody scheduled

`server/estimator.mjs` is under 200 lines, and it's the most interesting file in the repo. It learns the shuttle's pattern from sightings alone, predicts the next pass, grades itself on past days, and learns trip lengths from riders tapping a button.

It refits from scratch on every `GET /api/shuttle`. That sounds wasteful, but production had 10 sightings on November 9, 2026. Refitting takes almost no time at that size, and every new sighting changes the next answer right away. The model is called `learned-runs-v1`, and every prediction carries that name.

All the tuning knobs sit in one `settings` object at the top of the file. This chapter quotes their current values.

## Step 1. Clean the input

`sightingsAt()` keeps a sighting only if:

- it's at the configured checkpoint,
- it isn't a `duplicateOf` repeat,
- its camera time is at or before `now`,
- **and** its delivery time (`receivedAt`) is at or before `now`.

That last rule looks redundant. It isn't. When the backtest replays last Tuesday, an email that happened Tuesday but arrived Wednesday must not count. The model only gets what it would really have known at the time.

Each sighting becomes a Pacific date, a weekday, and a minute of the day (2:31:30 PM is `871.5`).

## Step 2. Weight by age

A sighting's weight halves every 21 days (`halfLifeDays`). A sighting from three weeks ago counts half. If the school moves the 3:12 run to 3:20, the new time takes over within a few weeks, but a stable pattern isn't forgotten after one quiet day.

## Step 3. Find runs

Sort every sighting by minute of the day, ignoring the date. Walk the list and start a new group wherever the gap to the previous sighting is more than 20 minutes (`gapMinutes`). Any group wider than 45 minutes (`maxWidthMinutes`) is split at its biggest internal gap, recursively.

Picture it as a timeline of a day with every sighting ever stacked on it. Runs are the clumps.

## Step 4. Throw out noise

A group seen on fewer than 2 distinct days (`minDays`) isn't a run. So one stray 9:45 AM trigger predicts nothing. A delivery truck on a single Tuesday doesn't create a phantom bus.

## Step 5. Summarize each run

A run's time is the **weighted median** of its sightings' minutes. Its spread is the weighted **median absolute deviation** times 1.4826, with a floor of 2 minutes. (1.4826 scales the MAD so it matches a standard deviation when the data is normal.)

Medians matter here. With a mean, one odd sighting 15 minutes late drags the run's time. With a median, it barely moves.

The run's ID is its time: a run at 3:12 PM is `run-1512`.

## Step 6. Learn which weekdays it runs

Every calendar day from the first sighting through yesterday counts as an observed day, whether or not a bus appeared. For each weekday, likelihood is:

```text
likelihood[w] = (weighted days the run appeared on w + pooled rate)
              / (weighted days observed on w + 1)
```

The `+ pooled rate` and `+ 1` add one imaginary day at the run's overall rate. Without it, a weekday seen once would swing straight to 0% or 100%.

Weekends with no sightings push the weekend likelihood down, which is what you want. Holidays do too. Feed outages also do, which you don't want. That bias is known and documented.

## Step 7. Predict

A run with likelihood of at least 0.5 (`minLikelihood`) on a date becomes an expected pass on that date. Its window is ±max(5 minutes, 2 × spread). The model looks 7 days ahead (`horizonDays`) and skips passes already seen today (within 20 minutes, `matchMinutes`).

The result is one of these `status` values:

| Status | Meaning |
| --- | --- |
| `unconfigured` | No run exists yet. "Learning the bus pattern." |
| `scheduled` | Here's the next expected pass: `nextCrossingAt`, `window`, `likelihood`, `historyCount`. |
| `estimated` | A bus was just seen, and its trip length is known. Here's a map marker and an arrival time. |
| `ambiguous` | More than one run, destination, or sighting could match. No position given. |
| `unknown` | Runs exist, but none is expected in the next week. |
| `offline` | The worker set this because the feed isn't current. The estimator never returns it. |

## Grading itself: the backtest

`backtest()` replays history one day at a time. For each past day, it trains a model with `now` set to one millisecond before that day started, predicts the day, then compares against what the camera really saw.

- A **hit** is a real sighting within 20 minutes of a predicted pass.
- A **miss** is a real sighting with no prediction nearby.
- A **false alarm** is a predicted pass nobody saw.
- **Window coverage** is the share of hits that landed inside the predicted window.

Every prediction ships its current score in a `quality` field, and the worker caches it per day and event count. On November 9, 2026, production's 10 sightings produced runs near 2:31 PM (Tue/Fri), 3:12 PM (Mon/Wed/Thu), and 4:03 PM (Tue/Wed), one rejected sighting, and a backtest of 2 hits and 3 misses over 5 days. That's the baseline any new model has to beat.

To see this for any history file:

```sh
npm run model:report
```

## Trip lengths from riders

A camera at the campus corner can't measure how long the bus takes to reach Fehren. Riders can.

When a rider in the map view taps "At Fehren" or "At campus", the worker logs an `arrived` report with that stop (chapter 4 covers the buttons). `learnTrips()` then:

1. Pairs each report with the latest sighting earlier that same day, at most 90 minutes before (`maxTripMinutes`).
2. Takes each day's median, so one day gets one vote. A rider tapping 40 times on Thursday counts as one Thursday.
3. Drops days more than 3 MADs from the median, with a 1-minute MAD floor (so anything within 3 minutes always survives).
4. Learns the stop once 3 days survive (`minTripDays`).

Choosing Fehren means the bus was outbound. Choosing campus means inbound. Because the camera sits at the campus corner, the code places it 5% along the route to Fehren and 95% along the route to campus. That placement is an assumption written down in `destinations`.

## Putting a bus on the map

`estimate()` returns `estimated` only when all of this lines up:

- Today has a sighting that matches a learned run.
- That run has a learned trip.
- The current time is between the sighting and sighting + trip length.
- Exactly one run-and-trip pair matches, and that pass has exactly one sighting.

Then the marker's progress moves linearly from the checkpoint's position toward 1. The uncertainty is the trip's spread plus 20% of elapsed time. The response labels this `rangeKind: 'heuristic-not-calibrated'`, and it means it. The number is a placeholder, not a measured error distribution.

If two candidates match, the answer is `ambiguous`. The code would rather show nothing than pick one.

---

## Grill session

**Q1.** History has sightings at 2:28, 2:31, and 2:35 PM on three different days, plus one at 9:45 AM on a Monday. How many runs does `learn()` produce, and what happens to the 9:45?

<details><summary>Answer</summary>

One run, around 2:31 PM. The three afternoon sightings are within 20 minutes of each other, so they form one group seen on three days. The 9:45 AM sighting forms its own group seen on one day, which is fewer than `minDays: 2`, so it's counted as noise. It shows up in `learned.noise` and predicts nothing.

</details>

**Q2.** A run appeared on every weekday for four weeks. Will the model predict it on a Saturday?

<details><summary>Answer</summary>

No. Each Saturday counts as observed but has no sighting. With roughly four observed Saturdays, likelihood is about `(0 + pooled) / (4 + 1)`. The pooled rate is about 5/7, so Saturday's likelihood lands near 0.14, well under 0.5. Weekends teach the model "no bus" by being empty. (Recency weighting shifts the exact numbers a little.)

</details>

**Q3.** Why does `sightingsAt()` filter on `receivedAt <= now` and not just `eventAt <= now`?

<details><summary>Answer</summary>

So the backtest can't cheat. An email sent Tuesday afternoon but delivered Wednesday morning wasn't available to a model predicting Tuesday. Filtering on delivery time means a replayed day only sees data that had arrived by then. Without it, the backtest would look better than live predictions really are.

</details>

**Q4.** Why a weighted median and not a weighted mean?

<details><summary>Answer</summary>

Robustness with tiny data. With 10 sightings total, one late bus or one stray trigger inside a run would pull a mean by minutes. A median barely moves. The same logic drives MAD for the spread and the per-day median vote for trip lengths.

</details>

**Q5.** A rider taps "At Fehren" 30 times on Thursday, each 20 minutes after the sighting. Every other rider on four other days reported 8 minutes. What trip length does the model learn?

<details><summary>Answer</summary>

8 minutes. Thursday collapses to one vote of 20 minutes. Across five days the median is 8 and the MAD is 0, so the floor of 1 minute applies and anything more than 3 minutes from 8 is dropped. Thursday's 20 is gone, four days survive, and four is at least `minTripDays: 3`.

</details>

**Q6.** The model knows trip lengths for both Fehren and campus on the 3:12 run. A bus is seen at 3:13 today. What status comes back, and why?

<details><summary>Answer</summary>

`ambiguous`, as long as `now` falls inside both trip windows. The camera can't tell direction, and both trips belong to that run, so two run-and-trip pairs are active. The model refuses to guess. Once the shorter trip's window ends, only one pair stays active and the response becomes `estimated` for the longer one.

</details>

**Q7.** Your new model scores 4 hits out of 5 on the backtest. The old one scored 2 hits and 3 misses. Ship it?

<details><summary>Answer</summary>

Not on that alone. Five days is a tiny sample, and a model tuned until it wins on the same five days has seen the test. [`arrival-estimation-research.md`](../arrival-estimation-research.md) asks for training on earlier weeks and testing on later weeks, never tuning against the final test period, and reporting error percentiles, optimistic errors, interval coverage, and abstention rate. Look at false alarms too. A model that predicts a pass every 10 minutes gets lots of hits.

</details>

**Q8.** Why does the code say `rangeKind: 'heuristic-not-calibrated'` instead of calling the range a 90% interval?

<details><summary>Answer</summary>

Because it isn't one. Spread plus 20% of elapsed time is a placeholder nobody measured. Calling it a confidence interval would claim a coverage rate the model never earned. The label is in the API contract, and the mobile app's schema rejects any other value.

</details>
