import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
const root = resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.csv':'text/csv; charset=utf-8'};
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) throw new Error('invalid path');
    let finalPath = filePath;
    try { if ((await stat(finalPath)).isDirectory()) finalPath = join(finalPath, 'index.html'); } catch { finalPath = join(root, 'index.html'); }
    const data = await readFile(finalPath);
    res.writeHead(200, {'content-type': types[extname(finalPath)] || 'application/octet-stream', 'cache-control': finalPath.endsWith('sw.js') ? 'no-cache' : 'no-store', 'service-worker-allowed': '/'});
    res.end(data);
  } catch (error) { res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); res.end(`Not found: ${error.message}`); }
});
server.listen(port, '0.0.0.0', () => console.log(`bospa running at http://localhost:${port}`));
