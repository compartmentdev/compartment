import { createServer } from 'node:http';
import { message } from './shared/message.mjs';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

console.log('dockerfile-monorepo booting');
console.log(`dockerfile-monorepo listening on ${port}`);

const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dockerfile Monorepo</title>
  </head>
  <body>
    <main>${message}</main>
  </body>
</html>`);
});

server.listen(port);
