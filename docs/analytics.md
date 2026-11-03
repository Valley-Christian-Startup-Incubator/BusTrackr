# Website analytics

BusTrackr uses the self-hosted Umami website `5eaf2f91-0cd8-48ce-84b1-1cc3244cf436` at https://analytics.valleychristianai.com on SSH host `valley-big-mac`. The collector and its PostgreSQL database run on that host. Native iOS and Android apps have no analytics SDK.

`public/analytics.js` is the canonical bootstrap. It initializes identity and listeners, then creates an asynchronous external Umami tracker on the landing, support, privacy and web app pages. The remote tracker never blocks app module startup. After the tracker loads successfully, the bootstrap loads the asynchronous Umami recorder with the same website ID. Both scripts respect the production-domain checks and analytics opt-out at document startup. A delayed or blocked recorder does not prevent app startup or event delivery. `npm run website:prepare` creates content-hashed copies for both the static website and the React app entry. Vite copies the versioned public asset into the app build. Deploy the app HTML and public assets together. Versioned URLs keep returning browsers from reusing a cached bootstrap after a collector change.

## Browser profiles

The bootstrap sets Umami's `data-distinct-id` before its first pageview. A random UUID is saved under `bustrackr.analytics.browser.v1` in localStorage. No accounts, fingerprint or push credentials are used. Blocking storage produces a page-local random UUID. If secure randomness is unavailable, the app continues with native Umami identity. The existing `umami.disabled` opt-out suppresses identity creation and interactions. Only the four exact production domains already allowed by the HTML enable analytics. Localhost and previews do not create an analytics ID or capture events.

Visitors represent anonymous browser profiles per origin, not people. Clearing storage, private browsing, another device or switching between domain aliases produces another profile. Shared school IP addresses do not merge distinct browser IDs. Umami's Visitors metric remains an estimate. An IP address change, browser update or rotating salt can count a profile again, while its Distinct ID links those visits.

## Events

| Event | Properties | Coverage |
| --- | --- | --- |
| `app_view` | `surface`, `value` of simple or map | Initial web app mode and subsequent mode changes |
| `ui_click` | `control`, `surface` | Every website and app button or link, including nested icons and keyboard activation |
| `ui_change` | `control`, `surface` | Committed demo-trip slider changes, excluding movement/input events |
| `notification_permission` | `surface`, `value` of granted, denied or default | Result of a user permission request |
| `notification_enabled` | `surface` | Successful subscription POST followed by local persistence |
| `notification_disabled` | `surface` | Successful DELETE, browser unsubscribe and local removal |
| `notification_failure` | `surface`, `value` of enable or disable | Failed user toggle operation |
| `notification_open` | `surface` | Worker focuses an existing page or opens the fixed app URL with a marker consumed once |

Surfaces are `landing`, `support`, `privacy`, `simple` and `map`. Controls are explicit `data-analytics` metadata and a finite bootstrap allowlist. They cover site navigation and footer/source links, Simple/Map selection, feed refresh, alerts, notification buttons, route/campus/building/sports/Fehren views, camera tools, camera/demo selection, estimate location, details/direction/follow/inspect/fleet, each of three shuttles, simulation pause/speed/reset, reconnect and about-dialog controls. `scripts/check-sitewide-analytics.mjs` checks every source control against the registry as well as rendered static and dynamic controls.

No DOM text, input values, feed contents, error messages, geographic coordinates, subscription endpoints or secrets enter interaction event properties. The before-send hook strips URL fragments and query parameters except `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content`, each capped at 120 characters. Referrers have all queries and fragments removed. Do not put personal information in campaign parameters. Native pageviews and campaign attribution remain enabled.

Tracking uses capture listeners and never waits before UI actions or navigation. At most 50 events wait for the tracker, for at most 30 seconds. A failed load discards them. The tracker owns delivery after loading; blocked delivery does not interrupt the app. No interval retry or unbounded queue is used.

## Replays and heatmaps

The school-hosted recorder captures sampled DOM changes, pointer movement, clicks, scrolling and navigation for replays and click or scroll heatmaps. Both features currently sample 15% of page loads independently. Each sampled page can record up to five minutes of replay; heatmap collection continues while the page remains open. Only new page loads can be recorded; historical visits are not reconstructed. Replay retention depends on the school server's cleanup configuration.

The server uses strict masking for page text and input values. Its block selector excludes camera observations and estimates, feed-status details, and the 3D canvas. Canvas recording is disabled by the recorder itself, so replays show the surrounding interface rather than the rendered 3D scene. DOM attributes and public navigation links can still appear in snapshots. Keep credentials and personal data out of page attributes and links.

The recorder does not support the tracker's before-send sanitizer. The bootstrap starts it only when the current page URL equals the sanitized URL, so unknown query parameters, fragments, oversized campaigns and noncanonical campaign encoding skip recording on that document. It does not change the visitor's URL. Later navigation URLs and fragments may appear in recordings and heatmaps. The event URL sanitization described above continues to apply to pageviews and control events.

Sampling means an individual visit can produce ordinary analytics without a replay or heatmap. Replays and heatmaps use the tracker's session cache and link to the same anonymous browser-profile UUID described above. Opening a replay requires the school analytics account. Native apps do not load the recorder.

## Inspect and verify

Before and after deployment, run `node scripts/check-recorder-settings.mjs`. This manual operational check reads the school collector's public recorder configuration and verifies the enabled features, sample rates, strict masking, replay duration and required block selectors. It also checks that the blocked IDs and classes still exist in the website or app source. The check makes a live network request, so it is not part of CI. Stored public replay and heatmap data must still be verified separately.

In the Umami dashboard, select BusTrackr and a date range. Visitors show browser-profile reach; pageviews show page traffic. Filter Events by `ui_click`, then inspect `control` and `surface` properties for individual controls. Use notification outcome events for completed setup rather than counting Notify me clicks. Mounting an already-enabled subscription never emits an enable conversion. Campaign reports show Instagram attribution, including `utm_campaign=simple-bryan-story`.

Run `npm run build`, `npm run website:check`, then `node scripts/check-sitewide-analytics.mjs`. The browser check serves the actual production build locally, intercepts production hosts, replaces only the 3D renderer with a deterministic stub, and uses a pinned copy of the deployed Umami 3.4 tracker against a mock collector. It sends no real analytics and never requests real notification permission or sends pushes. The fixture is the deployed `/script.js` captured November 2, 2026 from the MIT-licensed Umami project. Refresh it deliberately when upgrading the collector. Real deployed collection must additionally be checked after deployment, including the first pageview ID, aliases, campaign attribution and dashboard event properties.

The landing page preserves the deployed status polling behavior. It refreshes `/api/shuttle` every 30 seconds while visible after a successful request. Failures retry after 2, 5, 15 and then 30 seconds. Hidden pages pause scheduled polling; returning to the page, restoring it from browser history, or reconnecting triggers a refresh. The last camera sighting remains visible during transient feed failures. `node scripts/check-landing-feed.mjs` verifies retry recovery, retained sightings and hidden-page polling.
