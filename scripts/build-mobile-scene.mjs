import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';

const {build} = await import('esbuild').catch(() => {
  console.error('Root dependencies are missing. Run npm ci at the repository root, then retry.');
  process.exit(1);
});
const root = fileURLToPath(new URL('../', import.meta.url));
const paths = [
  'data/routes.json', 'local-scene/elevation.json', 'local-scene/footprints.json',
  'local-scene/ground-bounds.json', 'data/corridor.json', 'local-scene/road-profiles.json',
  'local-scene/roadside-roofs.json', 'local-scene/landscape.json',
  ...['grass-detail-albedo', 'shingles-albedo', 'stone-albedo', 'broadleaf-albedo'].map(name => `local-scene/${name}.webp`),
  'models/valley-bus.glb',
];
const mime = {'.json': 'application/json', '.webp': 'image/webp', '.glb': 'model/gltf-binary'};
const assets = Object.fromEntries(await Promise.all(paths.map(async path => [path,
  `data:${mime[extname(path)]};base64,${(await readFile(resolve(root, 'public', path))).toString('base64')}`,
])));
const result = await build({
  absWorkingDir: root, entryPoints: ['src/mobile-scene.ts'], bundle: true, write: false,
  minify: true, format: 'iife', target: ['safari16', 'chrome110'], legalComments: 'inline',
  define: {'import.meta.env.BASE_URL': '"./"'}, nodePaths: [resolve(root, 'mobile/node_modules')],
  plugins: [{name: 'packaged-scene-assets', setup(builder) {
    builder.onLoad({filter: /src\/local\/asset-urls\.ts$/}, () => ({loader: 'ts',
      contents: `const packaged:Record<string,string>=${JSON.stringify(assets)};\nexport function assetUrl(path:string){if(!packaged[path])throw new Error('Asset not packaged: '+path);return packaged[path];}\n`}));
  }}],
});
const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:;"><style>html,body,#world{margin:0;width:100%;height:100%;overflow:hidden;background:#d9e1db;touch-action:none}canvas{display:block}</style></head><body><div id="world" aria-label="3D campus and shuttle route"></div><script>${script}</script></body></html>`;
const output = JSON.stringify({html}) + '\n';
const target = resolve(root, 'mobile/src/map/scene.generated.json');
await writeFile(target, output);
console.log(`Packaged 3D scene with ${paths.length} local assets (${Math.round(Buffer.byteLength(output) / 1024 / 1024)} MiB).`);
