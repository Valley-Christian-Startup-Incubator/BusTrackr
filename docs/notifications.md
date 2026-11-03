# Enable bus notifications

Simple mode displays the age of the last camera observation without a timetable. Notifications report new camera sightings. They do not predict an arrival or establish travel direction.

## Configure the backend

The Node worker supports Web Push and Expo push. The old `hosting/` Vercel implementation does not serve notification routes.

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in the worker's private environment. Use a matching Web Push VAPID key pair. Keep the private key on the server. The configuration endpoint returns only the public key. Use an operator contact URI for the subject.

For local verification, a private key pair is available in ignored `.env.notifications`. Load both files:

```sh
node --env-file=.env.server --env-file=.env.notifications server/index.mjs
```

Set `NOTIFICATIONS_APP_URL` to the published web app. Add each browser origin to the comma-separated `ALERT_ALLOWED_ORIGIN` list. Native requests do not require an Origin header.

Deploy `server/notifications.mjs` alongside the existing server modules and install the updated `deploy/package.json` and lockfile. Keep the existing `.env.server` and camera state. The notification registry defaults to the camera state path plus `.notifications`. Override it with `NOTIFICATIONS_STATE_FILE` if needed. Back it up with the camera history.

After deployment, check `/api/notifications/config`. A configured browser sender returns a non-null `webPushPublicKey`. The web app's **Notify me** button requests permission and registers the browser subscription. On iPhone, add the web app to the Home Screen and open it there.

## Configure a native build

Link the mobile project to the actual EAS project and configure its Apple and Android push credentials. The repository does not contain an EAS project ID. The notification control reports that requirement instead of asking for unusable permission.

Set `NOTIFICATIONS_EXPO_ENABLED=true` on the backend after those credentials are ready. Set `EXPO_ACCESS_TOKEN` if Expo push access-token protection is enabled for that project. Rebuild and install the native application after adding the notifications config plugin. Expo Go and a JavaScript update alone do not provide the required native setup.

## Verify delivery

Enable notifications on the intended device. Trigger a genuine new camera alert. Verify receipt while the web page is closed or the native app is backgrounded. Provider acceptance and mocked tests do not establish device receipt.

The server suppresses duplicate, historical, future-dated, and pre-subscription observations. Both the camera time and receipt time must be within two minutes. Retries expire rather than sending stale sightings. Delivery can repeat after an ambiguous network failure. Event identifiers reduce duplicate banners where the platform supports them.

Turning alerts off removes the subscription using its private management secret. A failed request remains visible and can be retried. There is no public subscription list or arbitrary-message send endpoint.
