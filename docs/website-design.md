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

## Map-complementing variation

At the user's request, the loud yellow masthead was replaced by a map-led composition. Pale green-gray ground (#edf0e9), sage surfaces (#dfe6dc), charcoal-green ink (#263b37), and a subdued green action (#456354) complement the terrain, roofs and foliage in the actual scene. The first screen pairs a compact Fehren-to-Skyway heading with a tightly cropped campus view. Removed the giant wordmark, decorative marquee, duplicate route screenshot and leftover styling/font-fit code. The sighting now sits on a calm sage field with its operational details alongside it.

Claude consultation was attempted but returned a session-limit error; this variation was implemented and independently reviewed by Codex. Source lint and rendered checks pass with 0 failures at 1440/768/390. The inspector's stylistic warnings remain documented rather than hidden: this user-selected map palette and quiet treatment intentionally supersede the prior poster direction and its font/motion assumptions. Actual production-feed data was used in the layout review. Reports and screenshots: `.audit/map-look-shipping/`.

## Valley Christian Schools / BEI branding

BusTrackr is presented as a student project of BEI | Business, Entrepreneurship, & Innovation at Valley Christian Schools, following the VCS Brand Guidelines (rev. 9/2026, linked from vcs.net/brandguidelines). The product keeps the BusTrackr name; BEI appears as an endorsement in the website footer, the app's About dialog, and under the Simple view.

Colors come only from the VCS palette: PMS 540 navy `#003360` (ink, actions, footer, map backdrop), PMS 2905 Columbia `#8CD2F4` (the sighting field, selected controls, the primary route line), white grounds, and PMS 123 gold `#FFCC33` for sample/estimate tags and the second route line. Text uses approved colors only. The freshness scale on the age number (green, amber, red) is functional data and stays as it was.

Type: Montserrat stands in for Gotham/Proxima Nova and Libre Bodoni for Filosofia (both Google Fonts; the brand fonts need an Adobe Fonts license). Arial and Times New Roman are the guide's own fallbacks. Headlines are Montserrat Light, like the guide's own headings; Libre Bodoni is kept for the large sighting time, echoing the serif division wordmarks. The native app still uses system fonts.

Logos: never redraw, recolor, or approximate a VCS or BEI mark. The official BEI lockup must come from the VCS Marketing Portal (questions: marketing@vcs.net). The footers carry a commented slot for `assets/bei-lockup.svg` (reverse/white version on navy).
