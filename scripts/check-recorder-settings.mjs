import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const url = 'https://analytics.valleychristianai.com/api/websites/5eaf2f91-0cd8-48ce-84b1-1cc3244cf436/recorder';
const response = await fetch(url, {headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20_000)});
assert(response.ok, `Recorder settings returned HTTP ${response.status}`);
const settings = await response.json();
for (const [name, value] of Object.entries({enabled:true,replayEnabled:true,heatmapEnabled:true,maskLevel:'strict',sampleRate:0.15,heatmapSampleRate:0.15,maxDuration:300000})) {
  assert.equal(settings[name],value,`Unexpected live recorder setting ${name}`);
}
const blocks = new Set(settings.blockSelector.split(',').map(selector => selector.trim()));
const sourceHooks = [
  ['.simple-observation','src/main.tsx',/className="simple-observation"/],
  ['.camera-panel','src/CameraPanel.tsx',/className="camera-panel"/],
  ['#sighting-time','website/index.html',/id="sighting-time"/],
  ['#sighting-place','website/index.html',/id="sighting-place"/],
  ['#feed-estimate','website/index.html',/id="feed-estimate"/],
  ['#feed-state','website/index.html',/id="feed-state"/],
  ['#hero-live','website/index.html',/id="hero-live"/],
  ['.simple-feed-status [role="status"]','src/main.tsx',/className="simple-feed-status"><p role="status"/],
  ['canvas','src/world.ts',/new T\.WebGLRenderer\([^\n]+host\.appendChild\(renderer\.domElement\)/],
  ['.world','src/MapApp.tsx',/className="world"/],
];
for (const [selector, file, pattern] of sourceHooks) {
  assert(blocks.has(selector),`Live recorder does not block ${selector}`);
  assert.match(await readFile(new URL('../'+file,import.meta.url),'utf8'),pattern,`Blocked selector ${selector} no longer matches its source in ${file}`);
}
console.log('Live recorder settings passed. Replays and heatmaps enabled, strict masking, 15% sampling, five-minute replay limit and source privacy hooks verified.');
