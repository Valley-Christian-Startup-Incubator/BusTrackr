# Website analytics

BusTrackr uses the self-hosted Umami website `5eaf2f91-0cd8-48ce-84b1-1cc3244cf436` at https://analytics.valleychristianai.com on SSH host `valley-big-mac`. The collector and its PostgreSQL database run on that host. Native iOS and Android apps have no analytics SDK.

`public/analytics.js` is the canonical bootstrap. It initializes identity and listeners, then creates an asynchronous external Umami script on the landing, support, privacy and web app pages. The remote tracker never blocks app module startup. `npm run website:prepare` copies it into the static website and references a content-hashed copy. Vite copies the same source into the app build. Deploy the app HTML and public assets together. The unhashed app bootstrap should receive the deployment's normal revalidation policy.

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

No DOM text, input values, feed contents, error messages, coordinates, subscription endpoints or secrets enter interaction properties. The before-send hook strips URL fragments and query parameters except `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content`, each capped at 120 characters. Referrers have all queries and fragments removed. Do not put personal information in campaign parameters. Native pageviews and campaign attribution remain enabled.

Tracking uses capture listeners and never waits before UI actions or navigation. At most 50 events wait for the tracker, for at most 30 seconds. A failed load discards them. The tracker owns delivery after loading; blocked delivery does not interrupt the app. No interval retry or unbounded queue is used.

## Inspect and verify

In the Umami dashboard, select BusTrackr and a date range. Visitors show browser-profile reach; pageviews show page traffic. Filter Events by `ui_click`, then inspect `control` and `surface` properties for individual controls. Use notification outcome events for completed setup rather than counting Notify me clicks. Mounting an already-enabled subscription never emits an enable conversion. Campaign reports show Instagram attribution, including `utm_campaign=simple-bryan-story`.

Run `npm run build`, `npm run website:check`, then `node scripts/check-sitewide-analytics.mjs`. The browser check serves the actual production build locally, intercepts production hosts, replaces only the 3D renderer with a deterministic stub, and uses a pinned copy of the deployed Umami 3.4 tracker against a mock collector. It sends no real analytics and never requests real notification permission or sends pushes. The fixture is the deployed `/script.js` captured November 2, 2026 from the MIT-licensed Umami project. Refresh it deliberately when upgrading the collector. Real deployed collection must additionally be checked after deployment, including the first pageview ID, aliases, campaign attribution and dashboard event properties.
