import {cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const assets = resolve(dist, 'assets');

function stripModuleSyntax(source) {
  return source
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class)\s)/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
}

async function sortedFiles(directory, suffix, label) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing ${label} directory: ${directory}`);
    }
    throw error;
  }
  const files = names.filter(name => name.endsWith(suffix)).sort().map(name => resolve(directory, name));
  if (!files.length) throw new Error(`No ${suffix} files found in ${label}: ${directory}`);
  return files;
}

await rm(dist, {recursive: true, force: true});
await mkdir(assets, {recursive: true});
await cp(resolve(root, 'index.html'), resolve(dist, 'index.html'));
await cp(resolve(root, 'public'), dist, {recursive: true});

const runtimeSources = [
  'src/utils.js',
  'src/data.js',
  'src/connectivity.js',
  'src/store.js',
  'src/icons.js',
].map(path => resolve(root, path));
runtimeSources.push(...await sortedFiles(resolve(root, 'src/app-parts'), '.js', 'application parts'));

const javascript = (await Promise.all(runtimeSources.map(path => readFile(path, 'utf8'))))
  .map((source, index) => `\n/* bospa source ${index + 1} */\n${stripModuleSyntax(source)}`)
  .join('\n');
const bundlePath = resolve(assets, 'app.js');
await writeFile(bundlePath, javascript);

const syntaxCheck = spawnSync(process.execPath, ['--check', bundlePath], {stdio: 'inherit'});
if (syntaxCheck.status !== 0) throw new Error('Generated JavaScript bundle failed syntax validation');

const styleFiles = await sortedFiles(resolve(root, 'src/styles'), '.css', 'styles');
const styles = (await Promise.all(styleFiles.map(path => readFile(path, 'utf8')))).join('\n');
await writeFile(resolve(assets, 'styles.css'), styles);

const htmlPath = resolve(dist, 'index.html');
const html = await readFile(htmlPath, 'utf8');
await writeFile(htmlPath, html.replace('</head>', '<meta name="bospa-build" content="static-pwa" /></head>'));

console.log(`bospa built to ${dist}`);
console.log(`JavaScript parts: ${runtimeSources.length}; CSS files: ${styleFiles.length}`);
