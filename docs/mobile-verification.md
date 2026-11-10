# Native verification

Verified on October 26, 2026 with Expo SDK 57, React Native 0.86.3, and an iPhone 17 simulator running iOS 26.5.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run test:alerts` | 12 worker tests passed |
| `npm run check:mobile-scene` | Scene generated from source; offline geometry, presets, manual camera release, expiry, clearing and suspension passed with zero HTTP requests |
| `npm run build` | Web production build and scene geometry checks passed |
| `npm --prefix mobile test` | 15 mobile tests passed, including actual sample-worker HTTP contract |
| `npm --prefix mobile run typecheck` | Passed |
| `npm --prefix mobile run lint` | Passed |
| `npx expo-doctor` in `mobile/` | 21 of 21 checks passed |
| `npm --prefix mobile run export:native` | iOS and Android Hermes bundles exported |

The CI workflow repeats offline scene packaging and rendering checks, worker tests, the web build, mobile tests, typecheck, lint, and both native exports. Exporting a bundle does not establish native runtime behavior.

## Actual native interface

The app ran inside Expo Go in the iOS simulator. The following interactions were exercised through the native interface:

- Both sample directions display an arrival range. The current app displays the original detailed campus and route in a bundled WebGL renderer inside a native WebView.
- The unavailable sample state clears the amber marker while retaining the map and disabling Locate estimate.
- Campus and Buildings presets render the terrain and conservatory. Locate estimate shows the amber estimate. Native zoom and map expansion work.
- No timetable, ambiguous runs, stale feed, unavailable feed, loading, and empty observations hide the position estimate.
- Scheduled mode labels the future checkpoint crossing as a schedule, not an observation.
- Connection settings connect to the real local sample worker over HTTP in development mode.
- A worker response labelled `sample` retains the yellow sample banner even when selected as an API connection.
- Stopping the worker and pressing Refresh removes the range and marker while retaining the last camera timestamp and saved-email count.
- Returning to built-in sample mode works without the worker.

[3D campus screenshot](images/mobile-3d-campus.png) and [3D estimate screenshot](images/mobile-3d-estimate.png) show the running native app. The [unavailable feed screenshot](images/mobile-3d-unavailable.png) shows the map retained with no position estimate. Earlier [arrival and observation](images/mobile-arrival.png) and [schematic](images/mobile-route.png) screenshots document the preceding version. Expo Go's blue developer-tool button is part of the test host, not BusTrackr.

The local decision trail and raw outputs are in ignored `.audit/mobile-decisions.tsv`, `.audit/*-tests.txt`, `.audit/web-build.txt`, `.audit/mobile-typecheck.txt`, `.audit/mobile-lint.txt`, and `.audit/native/`. They contain sample data only.

## Review

Claude proposed the visual design from a generic product brief. Automatic approval review blocked sending repository contents to Claude; no repository files were supplied. Its design included assumptions unsupported by the API, so unconfirmed timetables and ambiguous runs suppress all estimates in the implemented app.

Independent Codex reviewers inspected the native app, worker, and web integration. Review fixes restrict development HTTP exceptions to actual local hosts, retain observations after failed manual refreshes, exclude ambiguous historical dates from estimator training, expire stale web estimates, and stop displaying delivery timestamps as camera times. The original native reviewer returned PASS+NOTES after checking the fixes, captured results, and native failure screenshot. The 3D integration review caught and fixed accepted server clock skew hiding markers and manual camera control snapping back after Locate estimate. A final reviewer caught a background-during-load readiness deadlock; foreground lifecycle messages now resume rendering before readiness, and an independent follow-up review passed. Cursor-specific cloud verifier and alternate model-family tools prescribed by Poteto Mode were unavailable; the review was local, not a cloud or cross-model source review.

The 3D scene packages 13 assets into a generated HTML bundle. It makes no remote map requests. Native cards, settings and camera controls remain React Native views. The packaged scene adds about 14 MiB to source and produces approximately 18 MB native JavaScript bundles, trading download size for offline visual parity. Scene changes require regeneration; CI rejects stale packages.

## Limits

Android runtime, physical phones, standalone native binaries, signing, and store submission were not verified. Local iOS verification used Expo Go. VoiceOver reading order, large-text layouts, multi-touch gestures, and physical-device background/resume behavior need further testing. Freshness and cancellation rules are covered by automated model and HTTP tests; scene suspension is also covered in the offline renderer test.

Live Gmail processing remains blocked on account-owner verification and credentials. The production timetable remains unconfirmed. No accurate operational ETA, GPS tracking, or confirmed departure is claimed.

The SDK 57 dependency audit reports eight transitive advisory entries. Five high entries are in the Expo CLI toolchain through `node-forge` and its Zod 3 dependency. Three moderate entries concern Expo Router's `query-string` decoder chain. The available decoder fix changes CommonJS to ESM, and the CLI's Zod fix requires a major version change. No incompatible forced overrides or SDK downgrade were applied. Recheck upstream SDK patches before public distribution. The application uses a current direct Zod version for its own API validation.

Fast mode could not be enabled or verified through the available app settings tools.

## November 1 interface refresh

Claude designed and implemented the refreshed React Native screen and map controls. Verified in Expo Go on an iPhone 17 Pro / iOS 26.5 simulator against the production API: the real October 30 observation appears with its date and age, the feed is connected, and the unconfirmed timetable suppresses estimates. Full-route preset, expanded map, return to details, connection settings, sample estimate mode, unavailable mode, and reconnecting to the production feed were exercised through native controls. Screenshot: `images/mobile-clean-interface.png`.

The 15 mobile tests, TypeScript check, lint and iOS/Android bundle exports passed. The packaged offline scene verification passed. This supplements the October 26 evidence; it does not constitute physical-device or signed store-build verification. The earlier Gmail credential blocker has been resolved through Resend receiving and verified Google ARC forwarding. See `release-readiness.md` for current remaining work.
