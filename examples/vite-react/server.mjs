import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const distDirectory = join(process.cwd(), 'dist');

console.log('vite-react booting');
console.log(`vite-react listening on ${port}`);

const server = createServer(async (request, response) => {
  if (request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const assetPath = readAssetPath(request.url ?? '/');
  const filePath = join(distDirectory, assetPath);

  try {
    const fileContents = await readFile(filePath);
    response.writeHead(200, { 'content-type': readContentType(filePath) });
    response.end(fileContents);
  } catch {
    const fallbackContents = await readFile(join(distDirectory, 'index.html'));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fallbackContents);
  }
});

server.listen(port);

function readAssetPath(urlPath) {
  if (urlPath === '/' || urlPath === '') {
    return 'index.html';
  }

  return normalize(urlPath.replace(/^\//u, ''));
}

function readContentType(filePath) {
  const extension = extname(filePath);

  switch (extension) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
