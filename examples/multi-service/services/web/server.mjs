import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

console.log('multi-service web booting');
console.log(`multi-service web listening on ${port}`);

const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: 'web' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Multi Service Web</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Palatino Linotype", "Book Antiqua", serif;
        background: linear-gradient(145deg, #f8f2de 0%, #ecd7a1 100%);
        color: #261504;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }

      main {
        padding: 3rem;
        border: 1px solid rgba(38, 21, 4, 0.14);
        background: rgba(255, 250, 239, 0.9);
        box-shadow: 0 24px 70px rgba(38, 21, 4, 0.16);
      }

      h1 {
        margin: 0 0 1rem;
        font-size: clamp(2rem, 6vw, 4rem);
      }

      p {
        margin: 0;
        font-size: 1.05rem;
      }

      p + p {
        margin-top: 0.85rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Multi Service Web</h1>
      <p>Primary route is alive.</p>
      <p id="proxy-status">Proxy route pending.</p>
    </main>
    <script>
      const proxyStatus = document.getElementById('proxy-status');

      fetch('/api/ready')
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }

          return await response.json();
        })
        .then((payload) => {
          proxyStatus.textContent = 'Proxy route says: ' + payload.service + ' is ' + payload.status + '.';
        })
        .catch((error) => {
          proxyStatus.textContent = 'Proxy route failed: ' + error.message;
        });
    </script>
  </body>
</html>`);
});

server.listen(port);
