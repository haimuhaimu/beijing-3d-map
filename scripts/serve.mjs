import http from 'node:http';
import path from 'node:path';
import { ROOT, RUNTIME_FILES, readRuntimeFile, isMain } from './runtime-files.mjs';

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.md': 'text/plain; charset=utf-8',
};

export function createPreviewServer({ rootDir = ROOT } = {}) {
  return http.createServer(async (request, response) => {
    const reply = (code, message) => { response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(request.method === 'HEAD' ? undefined : message); };
    if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); reply(405, 'Method not allowed'); return; }
    let pathname;
    try { pathname = decodeURIComponent(request.url.split(/[?#]/)[0]); }
    catch { reply(400, 'Invalid URL encoding'); return; }
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!pathname.startsWith('/') || !RUNTIME_FILES.includes(file)) { reply(404, 'Not found'); return; }
    try {
      const bytes = await readRuntimeFile(rootDir, file);
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'text/plain; charset=utf-8',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { reply(404, 'Not found'); }
  });
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  let port = 3036, dist = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dist') dist = true;
    else if (args[index] === '--port' && args[index + 1] !== undefined) port = Number(args[++index]);
    else throw new Error('Usage: npm start -- [--port 3036] [--dist]');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const server = createPreviewServer({ rootDir: dist ? path.join(ROOT, 'dist') : ROOT });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Beijing 3D map: http://127.0.0.1:${server.address().port}/${dist ? ' (dist)' : ''}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
