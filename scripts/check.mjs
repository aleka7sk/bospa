import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir) {
  const entries = await readdir(dir, {withFileTypes:true});
  const files=[];
  for (const entry of entries) {
    const path=resolve(dir,entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) files.push(path);
  }
  return files;
}

for (const file of [...await walk(resolve(root,'src')), ...await walk(resolve(root,'scripts')), ...await walk(resolve(root,'tests'))]) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const path of [
  'contracts/connectivity/v1alpha/event.schema.json',
  'contracts/connectivity/v1alpha/capabilities.schema.json',
  'contracts/connectivity/v1alpha/examples/booking-requested.json',
  'contracts/connectivity/v1alpha/examples/mock-capabilities.json',
  'public/manifest.webmanifest',
]) JSON.parse(await readFile(resolve(root,path),'utf8'));

console.log('Source syntax and JSON checks passed.');
