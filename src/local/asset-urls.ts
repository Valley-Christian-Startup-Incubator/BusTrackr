// Vite copies each scene file to assets/<name>-<hash>.<ext>. Those names change with the bytes, so the
// frontend handler and the deploy controller's asset registry keep them for a year across releases.
// The packaged mobile scene replaces this module with inlined data URLs (scripts/build-mobile-scene.mjs).
const urls=import.meta.glob([
 '../../public/data/{routes,corridor}.json',
 '../../public/local-scene/{elevation,footprints,ground-bounds,road-profiles,roadside-roofs,landscape}.json',
 '../../public/local-scene/{grass-detail,shingles,stone,broadleaf}-albedo.webp',
 '../../public/models/valley-bus.glb',
],{query:'?url',import:'default',eager:true}) as Record<string,string>;

export function assetUrl(path:string){
 const url=urls['../../public/'+path];
 if(!url)throw new Error('Scene asset is not bundled: '+path);
 return url;
}
