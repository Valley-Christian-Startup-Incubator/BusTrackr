# Valley Shuttle

New here? Start with [the BusTrackr field guide](docs/guide/README.md). It walks through the whole system in seven short chapters, each ending in a quiz.

BusTrackr includes a native Expo app in `mobile/`, a React web prototype with a local Three.js scene, and a camera-email worker. Both clients show checkpoint observations separately from arrival estimates.

## Product website and release

The product website source is in `website/`, with privacy and support pages. See [release readiness](docs/release-readiness.md) for current shipping blockers and [hosting instructions](docs/camera-alerts.md#product-website) to deploy it on the Mac.

## Native iOS and Android app

See [native setup and build instructions](mobile/README.md). The app connects to the public production feed without credentials; sample mode is available in Connection settings. It combines native controls and status cards with the detailed 3D campus and route, bundled offline in a local WebView.

## Run

```sh
npm install
npm run dev -- --port 4173 --strictPort
```

Open http://localhost:4173. No Cesium token or map-service account is required. All runtime scenery assets are served from this project.

```sh
npm run build
npm run preview -- --port 4174
```

The production base path is `/`. The landing page is `https://bustrackr.valleychristianai.com/` and the tracker opens at `/app` (its Vite entry is `app.html`); `/about.html` remains a copy of the landing page for older links. The website, map, and API are self-hosted on `valley-big-mac`. Use the [atomic website deployment procedure](docs/website-deployment.md) for website and map releases. These releases do not restart the camera worker or Cloudflare tunnel.

## Camera email alerts

Production API: `https://bustrackr.valleychristianai.com/api/shuttle`, hosted on `valley-big-mac` through Cloudflare Tunnel.

A signed Resend inbound-email webhook feeds the camera history and detection API. Gmail polling is no longer used. Run `npm run alerts:sample` to try the bundled alert and `npm run test:alerts` to verify it. See [camera alert setup](docs/camera-alerts.md) for credentials, hosting, and limitations. The default camera view shows timestamped observations and a separate estimated marker; Scene demo retains the simulated fleet. Predictions are learned from camera sighting history, with no typed-in timetable. [Research and design decisions](docs/arrival-estimation-research.md) explains the model, its self-scoring backtest and the XGBoost upgrade path.

## Pilot access

The tracker is open only to pilot members while the pilot runs. See [run the pilot](docs/pilot.md) to approve, list and remove members.

## Scene

Three.js renders a USGS elevation mesh clipped to the bus corridor and campus, using a local grid that blends measured lidar ground around campus into the retained route terrain (`public/local-scene/terrain-source.md`), with meter-scaled terrain materials and explicit modeled surfaces. Aerial imagery is used only as an offline reference and is never loaded by the renderer. OSM building footprints become locally textured walls and inferred pitched or flat roofs. Nearby roadside buildings receive windows, doors, gutters and estimated rooftop equipment; `public/local-scene/buildings-source.md` documents the height handling and inference limits. Three main campus roofs use authored architectural forms with elevations guided by USGS lidar. Raw point-derived roof meshes were rejected after close views exposed stepped artifacts; facade forms and sparse window groups remain approximate. Authored landmarks include the Conservatory glass canopy and stone entry, the quad tower, veranda and cross, stadium seating and lights, the competition pool, baseball fencing and dugouts, and parked vehicles. Ground placements are documented in `public/local-scene/grounds-source.md`. Trees use 602 offline instance placements; buildings, fields, and the route are excluded. Separate geometry provides side streets, paths, parking lots and bay paint, baseball infields, practice turf, tennis pads, and close-range dry grass clumps. The terrain follows the exact corridor boundary rather than a jagged grid cutoff. Route road surfaces now include estimated full carriageway widths, meter-scale asphalt, lane paint and curbs. `public/local-scene/roads-source.md` records the estimates and missing junction detail.

The original detailed bus GLB is reused for three simulated shuttles. Campus, Conservatory, quad, sports, Fehren, full-route, overhead, follow, and close-up cameras are available. Pause and speed controls affect the eight-minute demo trip cycles. These three demo-bus positions and ETAs are simulated. Camera mode displays separate observations and learned estimates when its backend is configured.

This is a working independent reconstruction, not photogrammetry-quality scenery. Ground material scale is independent of aerial resolution. Surface boundaries, small features, and facades remain approximate; route alignment, widths, elevations, and service access need school confirmation. The scene runs in the React web prototype and is bundled into the native Expo app in `mobile/`.

## Performance

The moving scene targets 30 FPS. Paused scenes render only while a view changes, and hidden tabs suspend rendering and the simulation clock. Geometry is merged by material; vegetation is instanced in spatial cells with simpler foliage once the camera is more than 240 meters from the entire batch bounding sphere; only buildings wholly inside the clipped area render. Resolution caps are 1 pixel per CSS pixel on phones and 1.4 on desktop. Shadows cover a local area at 1024/2048 pixels. Actual phone hardware still needs profiling.

Startup fetches run concurrently and use compressed WebP detail textures. The local reflection bake is deferred until a close architectural view is opened. Stalled asset requests show a retry action after 20 seconds. Run `npm run check:startup` against a production preview to verify the loading path; setup and measured timings are in `docs/performance.md`.

Inspect the `.world` element's `data-diagnostics` attribute for measured FPS, a rolling 30-sample average/minimum, draw calls, triangles, geometry/texture counts, and rendered building/tree counts. These browser measurements are not physical-device benchmarks.

## Regenerate assets

- `npm run fetch:local-aerial`: refresh offline reference imagery and its geographic extent.
- `npm run build:landscape`: rebuild the compact side-street, parcel, terrain-boundary, and tree-placement asset from the bundled OSM/NAIP references.
- `npm run build:local-footprints`: filter bundled OSM buildings and vegetation exclusions.
- `python3 scripts/build-road-profiles.py`: match route segments to bundled OSM names/classes and regenerate estimated road widths.
- `npm run build:corridor`: regenerate route corridor polygons after changing route data.
- `.venv-lidar/bin/python scripts/fetch-campus-lidar.py`: fetch and validate the fixed public-domain campus lidar tile.
- `.venv-lidar/bin/python scripts/build-roadside-roofs.py`: regenerate measured roadside roof-level profiles after changing footprints; roof forms and facade openings remain inferred.
- `.venv-lidar/bin/python scripts/build-local-terrain.py`: regenerate the runtime elevation grid from the retained DEM and downloaded class-2 lidar ground points.
- `.venv-lidar/bin/python scripts/build-campus-roofs.py`: regenerate the experimental point-derived roofs (retained for reference, not loaded by the renderer); requires numpy, scipy, laspy[lazrs], and pyproj in the Python environment.
- `npx tsx scripts/build-bus.ts`: rebuild the original bus GLB.

## Sources and licenses

- USDA/USGS NAIP aerial imagery (offline reference only): public domain, downloaded from the [National Map image service](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer). Exact provenance is in `public/local-scene/README.md`.
- USGS 3DEP elevation: public domain; bundled grid retains its geographic reference.
- © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL: routes and building footprints. Attribution remains visible in the UI. Generating our own meshes does not remove the underlying data attribution.
- Original synthetic stone, shingle, broadleaf and ground-detail materials were generated with the built-in image tool; complete prompts and limitations are in `public/local-scene/stone-source.md`, `public/local-scene/shingles-source.md` and `public/local-scene/broadleaf-source.md`, and `public/local-scene/grass-detail-source.md`. The distant tree texture is rendered locally from the same near-tree crown; its alpha-edge treatment and abrupt batch transition remain approximate.
- Original bus geometry; mesh lettering uses the Three.js Helvetiker example font, with its embedded license in `scripts/helvetiker.json`.
- The historical [school shuttle map](https://resources.finalsite.net/images/v1700598195/vcsanjose/dl7ylcazkn69aup72dro/VCS_Shuttle_Map.pdf) helped identify Fehren; its timetable is not presented as current.

Legacy Cesium scripts and reference assets remain in the branch history/source, but the scene does not import Cesium or request Google tiles. The old Esri aerial reference is not used by this renderer.

## Controls

Drag to pan by default. The Pan/Orbit toggle switches one-finger or left-mouse dragging to orbit; right-mouse dragging rotates in either mode. Pinch or scroll to zoom. Campus views use a compact phone panel; expand it to choose another shuttle or scrub the demo trip.

## POC release limits

The scenery is an authored approximation, with original detailed bus models and reference-informed campus landmarks. It is not photogrammetry. Demo bus positions and ETAs are simulated. Camera mode uses checkpoint observations and explicitly labelled schedule estimates; continuous GPS is not connected. Trip length, checkpoint placement/direction, school-verified routing, store signing and distribution, accessibility review and physical-phone profiling remain production work. Six roadside building envelopes use documented inferred height corrections to clear sampled uphill ground; small surface details and transparent glazing use simplified materials. See `docs/performance.md` for measured preview results and limitations.

## Node.js requirement

Use Node.js 22.23.4+, 24.22.1+, or 26.12.1+ for installs, builds, and server execution. Node 23 and 25 are unsupported.
