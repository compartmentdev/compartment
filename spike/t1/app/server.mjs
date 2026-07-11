import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const version = process.env.VERSION ?? 'v1';
const ready = process.env.READY !== 'false';
const sockets = new Set();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname === '/healthz') {
    response.writeHead(ready ? 200 : 503).end(ready ? 'ok' : 'not ready');
    return;
  }
  if (url.pathname === '/version') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end(version);
    return;
  }
  if (url.pathname === '/sleep') {
    const seconds = Number.parseInt(url.searchParams.get('seconds') ?? '30', 10);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    response.writeHead(200, { 'content-type': 'text/plain' }).end(`${version} slept ${seconds}s`);
    return;
  }
  if (url.pathname === '/oom') {
    const blocks = [];
    setInterval(() => blocks.push(Buffer.alloc(8 * 1024 * 1024, 1)), 10);
    response.writeHead(202).end('allocating');
    return;
  }
  response.writeHead(404).end('not found');
});

const webSocketServer = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    webSocketServer.emit('connection', client, request);
  });
});
webSocketServer.on('connection', (client) => {
  client.on('message', (message) => client.send(message));
});

server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => {
    for (const socket of sockets) socket.destroy();
    process.exit(0);
  }, 40_000).unref();
});

server.listen(port, '0.0.0.0');
