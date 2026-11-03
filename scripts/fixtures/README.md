# Umami tracker fixture

`umami-3.4.js` is the exact deployed Umami 3.4 tracker fetched from https://analytics.bryanhu.com/script.js on November 2, 2026. SHA-256 is `654f12c7548be726eba5b71d5ef8bffc2a41a39a0053e2a49a847869ccd7ac3f`.

The browser test uses this pinned tracker to exercise its real identity, initialization and before-send behavior without a network dependency or production analytics writes. The upstream project is https://github.com/umami-software/umami. The MIT license from the v3.4.0 tag is included in `umami-LICENSE`. Refresh the fixture deliberately when upgrading the deployed collector.
