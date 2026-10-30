# Run BusTrackr on a phone

BusTrackr is a native Expo and React Native app for iOS and Android. Native status cards and controls surround the detailed Three.js campus and route scene. The renderer runs in a local WebView with its terrain, buildings, textures, roads, and model bundled offline. It never loads a hosted website.

## Try sample mode

Install Node 22.23.4+, 24.22.1+, or 26.12.1+ and an Expo Go version compatible with SDK 57. From the repository root:

```sh
npm ci
cd mobile
npm ci
npm start
```

Scan the QR code with Expo Go on a phone. Keep the phone and development computer on the same network. Press `i` for an installed iOS simulator or `a` for a running Android emulator.

With no saved connection or environment URL, the app opens in sample mode. The yellow banner stays visible. Scroll to **Explore sample states** to try both directions, no confirmed timetable, ambiguous runs, stale data, unavailable service, loading, no observations, and a future scheduled run. Sample sightings and the timetable are illustrative and reset as the sample refreshes.

On hosts where Metro binds IPv6 localhost but Expo Go requests IPv4, use:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first npx expo start --localhost
```

## Connect the status service

Production URL: `https://bustrackr.valleychristianai.com/api/shuttle`.

Open **Connection settings**, enter the HTTPS status URL, and select **Connect to feed**. The URL must end in `/api/shuttle`. A bare origin gets that path automatically. The app saves the URL locally and immediately requests it. Failed or invalid responses show **Feed unavailable**. Select **Use sample data** to return to the demo.

You can also copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_SHUTTLE_API_URL` before starting or building. A saved selection takes precedence. `EXPO_PUBLIC_*` variables are public in the app bundle. Never put an account password, app password, OAuth token, or mailbox credential in them.

For a local worker, run `npm run alerts:sample` at the repository root. In an iOS simulator development session, connect to `http://127.0.0.1:8787/api/shuttle`. To connect a physical phone on your trusted local network, bind the worker explicitly:

```sh
ALERT_HOST=0.0.0.0 npm run alerts:sample
```

Use the computer's LAN address, for example `http://192.168.1.20:8787/api/shuttle`. `localhost` on a physical phone is the phone. Android Emulator normally reaches the host at `http://10.0.2.2:8787/api/shuttle`. Local HTTP is accepted only in development. Release builds require HTTPS. Native apps do not need browser CORS permission. Do not expose the worker directly to the public internet; use an operator-managed HTTPS endpoint.

The sample worker persists its first sighting and its startup check time. After two minutes the mobile app intentionally treats that check as stale. Restart the worker for a fresh check. The built-in sample mode is independent and remains usable without the worker.

Live camera ingestion uses a signed Resend inbound webhook. Configure the receiving address, API key, webhook secret, ID, and public URL on the server. The production schedule remains unconfirmed and empty. See [camera worker setup](../docs/camera-alerts.md).

## Check the app

From `mobile/`:

```sh
npm run typecheck
npm run lint
npm test
npx expo-doctor
npm run export:native
```

The contract test launches the actual sample worker, so install root dependencies first. Tests need permission to bind a loopback HTTP port. `export:native` creates Hermes bundles for both platforms; it does not compile or sign an IPA or APK.

For a local native debug build with installed Xcode or Android Studio:

```sh
npm run build:ios
npm run build:android
```

Expo generates ignored `ios/` and `android/` projects from `app.json`. Keep native configuration in Expo config. Test on a physical phone before distributing.

## Build an installable app

From `mobile/`, sign in to your Expo account and configure the project:

```sh
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile simulator --platform ios
npx eas-cli@latest build --profile preview --platform android
```

The simulator profile produces an unsigned iOS simulator app. The Android preview profile produces an APK. For a development client, first install `expo-dev-client` with `npx expo install expo-dev-client`, then use the development profile. Production builds use `--profile production --platform ios` or `--profile production --platform android`. EAS prompts for project ownership and signing credentials when required. Review the bundle identifiers in `app.json` before registering them. No app has been submitted to either store.

## Understand the display

The teal card shows the actual camera event time in Pacific time. Missing camera timestamps stay unknown; receipt time is labelled separately. A sighting does not establish vehicle identity, direction, or departure.

The arrival range and amber 3D marker come only from an eligible server prediction. The range is heuristic and uncalibrated. The modeled map does not establish GPS position, and no device location permission is requested. The map stays available when the feed is unavailable, but position estimates disappear.

Use Campus, Full route, Fehren, Buildings, and Sports to change the camera. Drag to pan, switch to Orbit to rotate, or use the zoom buttons. Locate estimate centers the current estimate. Expand map hides the details until you choose Show details.

The generated scene is committed so mobile builds work independently. After changing scene code or assets, run `npm run build:mobile-scene` at the repository root. Run `npm run check:mobile-scene` to verify deterministic packaging, offline rendering, camera controls, marker expiry, and rendering suspension. Install the test browser first with `npx playwright install chromium`.

Polling runs every ten seconds while foregrounded, with a ten-second request timeout. Failed requests, backgrounding, source changes, and responses older than 45 seconds hide estimates. Mailbox checks older than 120 seconds also hide estimates, even if the API is reachable. This is a conservative client policy; keep the server Resend health interval at 30 seconds or adapt both policies together. Timestamps more than 30 seconds ahead are rejected for freshness. A fresh feed can legitimately contain an old camera observation.

The app retains the last validated observation for the current source after a refresh failure. It does not persist observations across app restarts. Only the source URL or sample selection is stored locally.

See [verification evidence and limits](../docs/mobile-verification.md).
