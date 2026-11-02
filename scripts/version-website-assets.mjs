import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
const root = new URL('../website/',import.meta.url);
const check = process.argv.includes('--check');
const replacements = [];
for (const name of ['style.css','site.js']) {
  const bytes = await readFile(new URL(name,root));
  const dot = name.lastIndexOf('.');
  const versioned = `${name.slice(0,dot)}.${createHash('sha256').update(bytes).digest('hex').slice(0,16)}${name.slice(dot)}`;
  if (check) {
    const actual = await readFile(new URL(versioned,root));
    if (!bytes.equals(actual)) throw new Error(`Stale ${versioned}`);
  } else await writeFile(new URL(versioned,root),bytes);
  replacements.push({name,versioned});
}
for (const name of ['index.html','support.html','privacy.html']) {
  const path = new URL(name,root), html = await readFile(path,'utf8');
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
