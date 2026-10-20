// Zero-dependency static server for the repo root.
// Usage: node scripts/serve.mjs [--port 8080] [--prefix /my-repo/]
// With --prefix, files are served only under that path (simulates a GitHub Pages project site).
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const port = Number(arg('port', process.env.PORT || 8080));
let prefix = arg('prefix', '/');
if (!prefix.startsWith('/')) prefix = '/' + prefix;
if (!prefix.endsWith('/')) prefix += '/';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (prefix !== '/' && urlPath === prefix.slice(0, -1)) {
    res.writeHead(301, { Location: prefix });
    return res.end();
  }
  if (!urlPath.startsWith(prefix)) return send(res, 404, 'Not found');

  let file = path.join(root, urlPath.slice(prefix.length));
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');

  let stat;
  try {
    stat = statSync(file);
    if (stat.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(301, { Location: urlPath + '/' });
        return res.end();
      }
      file = path.join(file, 'index.html');
      stat = statSync(file);
    }
  } catch {
    return send(res, 404, 'Not found');
  }

  res.writeHead(200, {
    'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}${prefix}`);
});
