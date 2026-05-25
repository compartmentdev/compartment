import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { message } from '@compartment-e2e/pnpm-shared';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const buildMessage = readFileSync(new URL('./dist/build.txt', import.meta.url), 'utf8').trim();

console.log('railpack-pnpm-workspace booting');
console.log(`railpack-pnpm-workspace listening on ${port}`);

const server = createServer((request, response) => {
  if (request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ message, buildMessage }));
});

server.listen(port);
