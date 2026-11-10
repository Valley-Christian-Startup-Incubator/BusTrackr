import {createHash} from 'node:crypto';
import {readFile, writeFile, readdir} from 'node:fs/promises';
const root = new URL('../website/',import.meta.url);
const check = process.argv.includes('--check');
const replacements = [];
for (const name of ['style.css','site.js','analytics.js']) {
  const bytes = await readFile(name === 'analytics.js' ? new URL('../public/analytics.js', import.meta.url) : new URL(name,root));
  if (name === 'analytics.js') {
    if (check && !bytes.equals(await readFile(new URL(name,root)))) throw new Error('Stale analytics.js');
    if (!check) await writeFile(new URL(name,root),bytes);
  }
  const dot = name.lastIndexOf('.');
  const versioned = `${name.slice(0,dot)}.${createHash('sha256').update(bytes).digest('hex').slice(0,16)}${name.slice(dot)}`;
  if (check) {
    const actual = await readFile(new URL(versioned,root));
    if (!bytes.equals(actual)) throw new Error(`Stale ${versioned}`);
  } else await writeFile(new URL(versioned,root),bytes);
  if (name === 'analytics.js') {
    const asset = new URL(`../public/${versioned}`,import.meta.url);
    if (check) {
      if (!bytes.equals(await readFile(asset))) throw new Error(`Stale public/${versioned}`);
    } else await writeFile(asset,bytes);
    const entry = new URL('../app.html',import.meta.url), html = await readFile(entry,'utf8');
    const next = html.replace(/(["'])\/analytics(?:\.[a-f0-9]+)?\.js\1/g,`"/${versioned}"`);
    if (!next.includes(`"/${versioned}"`)) throw new Error('Missing app analytics bootstrap');
    if (check && next !== html) throw new Error('Run npm run website:prepare: app analytics URL is stale');
    if (!check) await writeFile(entry,next);
  }
  replacements.push({name,versioned});
}
const pages = ['index.html','support.html','privacy.html'];
const present = await readdir(root);
for (const name of ['about.html','signin.html']) if (present.includes(name)) pages.push(name);
for (const name of pages) {
  const path = new URL(name,root), html = await readFile(path,'utf8');
  if (name === 'index.html' && html.includes('<div id="root">')) continue;
  let next = html;
  for (const {name,versioned} of replacements) {
    const [stem,ext] = name.split('.');
    next = next.replace(new RegExp(`(["'])${stem}(?:\\.[a-f0-9]+)?\\.${ext}\\1`,'g'),`"${versioned}"`);
    if (!next.includes(`"${versioned}"`)) throw new Error(`Missing ${versioned} in ${name}`);
  }
  if (check && next !== html) throw new Error(`Run npm run website:prepare: ${name} has stale asset URLs`);
  if (!check) await writeFile(path,next);
}
console.log(check?'Website asset versions verified.':'Website asset URLs versioned by content.');
