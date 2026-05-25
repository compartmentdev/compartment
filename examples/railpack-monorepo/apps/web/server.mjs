import { createServer } from 'node:http';
import { message } from '@railpack-monorepo/shared';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

console.log('railpack-monorepo booting');
console.log(`railpack-monorepo listening on ${port}`);

const server = createServer((request, response) => {
  if (request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ message }));
});

server.listen(port);
