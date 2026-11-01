# BusTrackr release readiness

Audit: November 1, 2026. This is a working prototype with a live camera observation feed, not a store release.

## Ready

- Backend on valley-big-mac, HTTPS through Cloudflare Tunnel, signed Resend ingestion and persistent event history.
- Both fehren receiving addresses configured; one genuine October 30 alert recovered and displayed by the app.
- Bundled offline 3D campus scene and native observation/estimate interface.
- Sample, unavailable, stale and unconfirmed timetable states.

## Required before a useful public release

1. Confirm the service timetable, operating days/holidays, camera checkpoint location and direction. `server/schedule.json` remains empty and unconfirmed. Without this, observations work but arrival estimates cannot run.
2. Observe several real service runs through both receiving addresses; validate timestamps, forwarding, duplicate handling, and recovery from delivery failures. One genuine alert is insufficient evidence of reliable ongoing tracking.
3. Test on physical iPhone and Android devices: 3D load time and memory, small screens, larger text, screen readers, background/resume, poor connectivity and battery use. Browser verification does not certify the native WebView.
4. Register/confirm Apple and Google developer ownership, final bundle IDs and EAS project. Build signed production binaries and distribute an internal/TestFlight beta. No store submission or signed production build has been completed in this chat.
5. Prepare store screenshots, descriptions, age/content ratings, privacy disclosures, support details and review instructions. Review the website privacy text against actual operations before using it as the store policy. Identify a responsible operator/support owner and confirm school branding/route permissions.
6. Set operational ownership: restart after machine reboot, alerting on backend/tunnel failure, off-machine state backups and restore drill. Current LaunchAgents restart failed processes, but unattended startup before user login is not configured.

## Site

The product website is live at https://bustrackr.valleychristianai.com/, with `/api/*` reserved for the service. Published November 1 after restoring SSH access using `IPQoS none` and persistent connection reuse. It links to the existing 3D web prototype and clearly states native store availability. See `website/` for source. Deploy site files together with `server/website.mjs` and restart the worker; never copy server environment files into the website directory.

## Release checks

Run backend tests, scene packaging checks, mobile typecheck/lint/tests and native bundle export. These verify source and bundling, not physical-device performance or store approval. Review the release against current Apple and Google requirements when preparing submission.
