import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json',root),'utf8'));
await mkdir(new URL('hosting/server/',root),{recursive:true});
for (const name of ['alerts.mjs','resend.mjs','forwarded-auth.mjs','blob-state.mjs','cloud-receiver.mjs','estimator.mjs','schedule.json']) {
  await copyFile(new URL(`server/${name}`,root),new URL(`hosting/server/${name}`,root));
}
await writeFile(new URL('hosting/package.json',root),JSON.stringify({name:'bustrackr-api',private:true,type:'module',engines:{node:'24.x'},overrides:pkg.overrides,dependencies:Object.fromEntries(['@vercel/blob','mailparser','mailauth','svix','zod'].map(name=>[name,pkg.dependencies[name]]))},null,2)+'\n');
