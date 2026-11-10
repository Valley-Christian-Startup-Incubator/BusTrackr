# Shuttle arrival estimation research and design decisions

Updated November 9, 2026. This design turns camera email observations into estimates for the Fehren–Skyway shuttle. The model learns recurring checkpoint passes from sighting history and scores itself by replaying past days. The October 16 version needed an operator-confirmed timetable that never arrived, so it never ran. XGBoost is a candidate replacement once labelled travel times exist, not a requirement for launch.

## What the camera establishes

The supplied alert shows a sender of `Avigilonalerts@vcs.net` and body text in this form:

```text
[2026-Oct-16 02:06:43 PM (PDT)] BEI Bus has arrived.
```

The body timestamp is the observation time. The email Date header and IMAP internal delivery time describe different events and are retained separately. A body timestamp is sender-reported evidence, not proof of a correctly synchronized camera clock. The meaning and geographic placement of BEI, whether the zone sees both travel directions, whether the camera distinguishes buses from other vehicles, and whether several buses serve the route remain to be confirmed.

A single checkpoint history can train expected crossing time, lateness and headway. It cannot independently label onward travel time or exact positions. A second checkpoint, driver arrival/departure records, or a temporary GPS collection period can supply those labels. A return sighting identifies a cycle duration only when bus identity and run pairing are established; loading and waiting remain mixed into that duration.

Published results must be interpreted with that difference in mind. [BusTime](https://arxiv.org/html/2003.10373v1) evaluated 4,311 processed bus trips from approximately 30-second GPS records, not anonymous email sightings. Its comparison illustrates accuracy/computation tradeoffs and chronological evaluation; its reported errors are not an accuracy forecast for this app. The newer [hybrid Markov bus travel-time paper](https://arxiv.org/abs/2503.05907) supports considering probabilistic travel times, but does not establish the best model for this route.

## First version implemented

The source of truth is camera event history, not an animated bus. Each distinct email retains a hashed message identity, checkpoint, camera event time, delivery time, email header time and timestamp provenance. Raw email bodies, attachments, addresses and mailbox credentials are not returned by the public status API. Reprocessing the same message does not create another event. Distinct notifications within a configurable 30-second window at the same checkpoint are preserved with `duplicateOf`, then excluded from estimator inputs. This is a provisional grouping assumption: two buses within the window may be grouped. Keep the raw event records so grouping can be revised when real camera identifiers become available.

## Learned runs (current model, `learned-runs-v1`)

There is no typed-in timetable. `server/estimator.mjs` learns when buses pass the checkpoint from the sighting history on every request, so each new sighting changes the next prediction. Settings live in `settings` at the top of that file.

1. **Clean the input.** Use only sightings at the configured checkpoint that both happened and were delivered before the prediction time. Drop `duplicateOf` repeats. Convert to America/Los_Angeles dates and minutes of the day.
2. **Weight by recency.** A sighting's weight halves every 21 days, so a schedule change takes over within a few weeks without forgetting a stable pattern.
3. **Find runs.** Sort sightings by time of day and split where neighbours are more than 20 minutes apart. Split any group wider than 45 minutes at its largest gap.
4. **Reject noise.** A group seen on fewer than two distinct days is not a run. A stray 9:45 AM trigger therefore predicts nothing.
5. **Summarise robustly.** A run's time is the weighted median and its spread is the weighted median absolute deviation (×1.4826, at least 2 minutes). One odd sighting inside a run barely moves either.
6. **Learn weekdays.** Every calendar day from the first sighting through yesterday counts as observed. A run's likelihood on a weekday is the recency-weighted share of those weekdays it appeared on, with one pseudo-day at the run's overall rate so a weekday with little history doesn't swing to 0 or 1. Weekends and holidays without sightings push likelihood down. Feed outages do too, which is a known bias.
7. **Predict.** Runs with likelihood of at least 0.5 on a date become expected passes, with a window of ±max(5 min, 2×spread). Passes already seen today are skipped. The response is `scheduled` with `nextCrossingAt`, `window`, `likelihood` and `historyCount` (days the run was seen), or `unconfigured` while no run exists yet.
8. **Learn trip length from riders.** A rider who taps "the bus is here" picks Fehren or campus. Each such report is paired with the latest sighting earlier that day, at most 90 minutes before it. Each day casts one vote (the median of its reports), so repeated taps can't outvote other days. Days more than 3 MADs (at least 3 minutes) from the median are dropped. A destination is learned once 3 days remain, and it applies to the learned runs those days' sightings belonged to. Fehren means outbound and campus means inbound. The camera sits at the campus corner, so it is treated as 5% along the route to Fehren and 95% along the route to campus. That placement is an assumption.
9. **Position.** When today's sighting belongs to a run with a learned destination, the response is `estimated` with `destination`, a map marker and an arrival time of sighting plus trip length. Two sightings for one pass, or a run with reports for both stops, stay `ambiguous`. Runs riders never reported on get no position.

**Self-evaluation.** `backtest` replays history one day at a time, predicting each day only from sightings delivered before it began, then scores hits (within 20 minutes), misses, false alarms, mean error and window coverage. Every prediction carries the current score in `quality`, and the rider feedback log stores it with each report. `npm run model:report` prints the learned runs, the score and the next prediction for any history file. On November 9, 2026 production's 10 sightings gave runs near 2:31 PM (Tue/Fri), 3:12 PM (Mon/Wed/Thu) and 4:03 PM (Tue/Wed), one rejected sighting, and a backtest of 2 hits and 3 misses over 5 days. That is the baseline to beat.

Only observations both occurring and delivered by the prediction time are available to the model. This prevents retrospective evaluation from using emails that arrived later. The map uses an amber estimated marker and route band, visually separate from the three simulated buses.

The displayed range is a heuristic, not a confidence claim: two minutes plus 20% of elapsed time from a camera anchor, or the learned pass window without one. The heuristic is an engineering placeholder, not a measured error distribution. Uniform distance progress is also an assumption; the model has no measured segment speeds, dwell times or current traffic in this version. Observations at a terminal do not prove departure afterward. If a camera only observes arrival before a variable layover, do not configure it as an onward-departure anchor without modelling or measuring that layover.

## Why this architecture

| Decision | Reason | Alternative and upgrade trigger |
| --- | --- | --- |
| Retain events separately from estimates | Predictions must not become training labels; repeated email deliveries must not inflate data | Add confirmed departure/arrival labels and model evaluation records as they become available |
| Start with weighted medians | Inspectable, robust to isolated odd sightings, useful with little data | Compare EWMA, regression and boosted trees with the same day-by-day backtest |
| Learn checkpoint lateness first | It is directly observable with the current sensor | Learn trip/segment duration only after paired ground truth exists |
| Learn the pass pattern, not a timetable | Sightings are the only data that keeps arriving; a typed timetable never did | Add school-calendar dates or a second checkpoint when the backtest shows systematic misses |
| Suppress ambiguous positions | Anonymous sightings cannot reliably identify multiple shuttles | Use camera direction, vehicle ID, a second sensor or driver/GPS data |
| Keep rendering independent of the model | A future model should change predictions without changing map geometry | Retain the estimate API contract when replacing the predictor |
| Use one Node worker and a local SQLite history | Small, inspectable deployment that survives ordinary restarts | Move to Postgres when multiple workers need the history |

History is an append-only SQLite file with daily snapshots (see `docs/camera-alerts.md`). The estimator refits on each request, which is cheap at this data size.

## Traffic data

Traffic should estimate travel on the confirmed bus corridor, not on an API-selected shortcut. Driving-time estimates omit bus loading, school access and layovers. A useful later baseline is traffic travel time plus the median measured bus-specific correction. Historical training features must be snapshots available at prediction time, never later revised traffic or the eventual arrival.

[Mapbox Directions](https://docs.mapbox.com/api/navigation/directions/) provides a driving-traffic profile, typical duration and segment duration/congestion annotations. It is a technical candidate, not a settled procurement choice: confirm coverage on this corridor, display requirements, retention rights and explicit model-training rights before building a feature archive. Cache or persist provider responses only as permitted by the applicable agreement. Share server-side estimates between viewers rather than making one traffic request per viewer.

[Google Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes) also exposes traffic-aware travel times, but [Google Maps standard terms section 3.2.3(c)](https://cloud.google.com/maps-platform/terms) prohibit using Maps content to train, test, validate or fine-tune ML/AI models. Its [Routes display policies](https://developers.google.com/maps/documentation/routes/policies) also matter for a custom map. Do not assume Google traffic can be archived as training features or displayed on this Three.js map under standard terms. Provider selection remains open.

## Model upgrade path

| Candidate | Intended use |
| --- | --- |
| Rolling median or EWMA | Low-data calendar/lateness baseline; compare smoothness and responsiveness |
| Linear model or generalized additive model | Interpretable calendar/traffic effects and a useful benchmark |
| XGBoost | First nonlinear candidate for trip-duration or traffic-baseline residual prediction |
| CatBoost | Challenger when run ID, direction and other categorical inputs are important |
| LSTM or Transformer | Later experiment only if substantial sequential trajectory data justifies the added complexity |

For XGBoost, train one row per measured journey or labelled segment. Suggested features: service direction, run ID, local departure time, weekday, school-calendar category, checkpoint delay, recent completed journeys, and licensed traffic snapshots. Predict actual duration or the error of the baseline. Avoid exact week number as an initial feature; school calendar and recent history have clearer meaning, and a small dataset cannot support fine seasonal categories.

[XGBoost quantile regression](https://xgboost.readthedocs.io/en/release_3.1.0/python/examples/quantile_regression.html) supports 10th, 50th and 90th percentile outputs. These can form an estimated arrival window; quantile crossing and actual coverage need testing. [CatBoost](https://catboost.ai/docs/en/features/categorical-features) supports categorical inputs directly. Neither library establishes a winner for this dataset.

[Conformalized quantile regression](https://arxiv.org/abs/1905.03222) is a possible calibration layer. Its usual guarantees depend on assumptions such as exchangeability; changing school schedules, incidents and serially correlated trips require empirical coverage monitoring rather than unconditional guarantees. A complex state-space or particle-filter layer may later track competing direction/location hypotheses, but cannot create missing observations.

## Evidence required before upgrading

Use earlier weeks to train and later weeks to validate/test. Keep all records from a journey and service day together. Historical rolling features must use only data available then, and model selection must not repeatedly tune against the final test period. [Time-series cross-validation documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) explains the future-data leakage problem; service-day splits are more suitable here than blindly splitting irregular email rows.

Compare schedule-only, median-delay and candidate ML estimates on identical held-out journeys. Report MAE in seconds, median absolute error, 90th-percentile absolute error, optimistic errors that could make riders miss a bus, interval coverage and width, and the fraction of journeys where the system abstains. Break results down by direction and prediction horizon. Avoid relying on percentage error when remaining time approaches zero.

No fixed sample count guarantees readiness. Promote a model only when it repeatedly improves forward-held-out performance and retains acceptable range coverage. Retraining weekly after labelled data arrives is a starting operational choice, not a research-backed optimum. Keep the baseline available for missing features, traffic outages or model regressions. A second observation point may improve this app more than changing ML libraries.

## Gmail ingestion decisions

The worker polls Gmail IMAP over TLS, opens the mailbox read-only, backfills seven days of matching mail on its first connection, and persists a UID cursor scoped to mailbox identity and UID validity. Historical events retain historical times; importing them does not make them current arrivals. `IMAP_BACKFILL_DAYS=0` preserves the original future-mail-only behavior.

A browser account password is not the Gmail IMAP credential. [Google's app-password guidance](https://support.google.com/accounts/answer/185833?hl=en) requires 2-Step Verification and describes availability restrictions. [Gmail XOAUTH2 documentation](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol) specifies token authentication and the full-mail IMAP OAuth scope. The worker supports an app password, a supplied access token, or automatic access-token refresh using preauthorized Google OAuth client/refresh credentials. OAuth consent setup and token issuance are not implemented. A Gmail API integration with a narrower read scope is a future alternative.

Sender/body matching is an allowlist, not cryptographic sender verification. Confirm provider spam/authentication policy before treating alerts as authoritative. Live mailbox processing remains unverified until Google verification and an app credential or OAuth grant are completed. Production deployment also needs an always-on host; GitHub Pages can serve the UI only.
