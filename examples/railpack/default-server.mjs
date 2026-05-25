import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

console.log('railpack default booting');
console.log(`railpack default listening on ${port}`);

const server = createServer((_request, response) => {
  response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('run.command override was not applied');
});

server.listen(port);
