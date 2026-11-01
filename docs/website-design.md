# Website direction

The public website is for students using the Fehren–Skyway shuttle. Its main action opens the working web app. It is not the backend's technical manual.

Use Leonxlnx's `design-taste-frontend` skill for subsequent visual work and ask Claude to design the interface, as required by the project instructions. Read the skill from its installed path if a delegated session's skill catalog has not refreshed.

The subject's own material is the Fehren/Skyway route, the modeled campus and its buildings, the camera observation, Pacific timestamps, and the original detailed 3D scene. Use these instead of generic feature illustrations or invented testimonials.

The homepage should communicate the route and product quickly, show the actual scene at meaningful scale, provide concise real feed status, and offer one primary action. Keep operational limitations truthful and proportionate. Put detailed authentication, prediction behavior, failure modes and release requirements on Support and in repository documentation.

Avoid the rejected layout: oversized technical headings, full-width rounded information cards, observed/estimated/modeled taxonomy, repeated caveat lists, and a long proof-of-concept disclaimer tour. Changing the radius and colors does not fix that structure.

Verify the final render at 1440, 768 and 390 pixels, inspect all pages/screenshots, exercise links and any live controls, and compare it with the preceding version before deployment. An automated style score alone does not establish a good design.

## November 1 corrective pass

Installed/refreshed upstream Leonxlnx/taste-skill for both Codex and Claude. Claude applied the sheet `name-as-monument`, seed `735201445`. The bus's yellow/black lettering became the oversized masthead; the camera timestamp became the live departure-board element. The panorama carries the real campus, and the technical taxonomy moved to Support. The source stack stayed plain HTML/CSS/JS.

Adaptations: bus yellow/navy replaced the dealt white/blue palette; heavy system sans preserved the transit lettering and avoided third-party font loading; the hero uses the original scene panorama instead of the sheet's small picture square. Removed the repeated oversized close and footer wordmark after reviewing mobile screenshots. All pictures are existing project-owned 3D scene/interface captures, with OSM/USGS attribution; no stock pictures or fabricated proof were added.

Measured at 1440/768/390: source lint 0 failures and 0 warnings; rendered inspection improved from 8 failures to 0. Remaining warnings are intentional: no unrelated video was introduced, and the locally rendered system type replaces the dealt hotel-like serif pairing. Homepage copy dropped from 927 to 191 words. Both the unavailable feed and real production observation were rendered. The old web-app link returned 404 after the repository transfer; it now uses the live organization Pages URL, with the production API build variable and matching CORS origin configured.

Final screenshot critique: design 7/10, usability 8/10, creativity 7/10, content 8/10; weighted 7.4/10. The hierarchy is decisive, the route belongs to this subject, and the card/documentation template is removed. Remaining limitations: the 3D source images are not high-resolution photography; the mobile gallery still creates a substantial scroll; physical visitor feedback is not established by our own ratings. Screenshots and reports are retained locally in `.audit/taste-shipping/`.
