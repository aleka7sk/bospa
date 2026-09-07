import http from 'node:http';
import https from 'node:https';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || process.env.PORT || 4173);
const apiUpstream = process.env.BOSPA_API_UPSTREAM?.replace(/\/$/, '') || '';
const types = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.csv':'text/csv; charset=utf-8',
};

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(self), geolocation=(), microphone=()');
  res.setHeader('content-security-policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self' blob:");
}

function proxyToAPI(req, res, url) {
  const target = new URL(`${apiUpstream}${url.pathname}${url.search}`);
  const client = target.protocol === 'https:' ? https : http;
  const headers = {...req.headers, host: target.host};
  delete headers.connection;
  delete headers['content-length'];

  const upstream = client.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method: req.method,
    headers,
    timeout: 35_000,
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('API timeout')));
  upstream.on('error', error => {
    if (!res.headersSent) {
      res.writeHead(502, {'content-type':'application/json; charset=utf-8'});
    }
    res.end(JSON.stringify({error:{code:'api_unavailable', message:'Bospa API недоступен.', detail:error.message}}));
  });
  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (apiUpstream && url.pathname.startsWith('/api/')) {
    proxyToAPI(req, res, url);
    return;
  }

  try {
    securityHeaders(res);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const candidate = normalize(join(root, pathname));
    if (!candidate.startsWith(root)) throw new Error('invalid path');

    let finalPath = candidate;
    try {
      if ((await stat(finalPath)).isDirectory()) finalPath = join(finalPath, 'index.html');
    } catch {
      finalPath = join(root, 'index.html');
    }
    const data = await readFile(finalPath);
    const extension = extname(finalPath);
    const cache = finalPath.endsWith('sw.js') || extension === '.html' || extension === '.js' || extension === '.css'
      ? 'no-cache'
      : 'public, max-age=86400';
    res.writeHead(200, {
      'content-type': types[extension] || 'application/octet-stream',
      'cache-control': cache,
      'service-worker-allowed': '/',
    });
    res.end(data);
  } catch (error) {
    res.writeHead(404, {'content-type':'text/plain; charset=utf-8'});
    res.end(`Not found: ${error.message}`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`bospa web running at http://localhost:${port}`);
  if (apiUpstream) console.log(`proxying /api/* to ${apiUpstream}`);
});
