import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

console.log('multi-service backoffice booting');
console.log(`multi-service backoffice listening on ${port}`);

const server = createServer((request, response) => {
  if (request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: 'backoffice' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Multi Service Backoffice</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Trebuchet MS", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(255, 214, 153, 0.72), transparent 34%),
          linear-gradient(160deg, #1c2c46 0%, #2a4671 55%, #22385c 100%);
        color: #f6f3ee;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }

      main {
        padding: 3rem;
        border: 1px solid rgba(246, 243, 238, 0.18);
        background: rgba(15, 25, 45, 0.66);
        box-shadow: 0 28px 84px rgba(6, 10, 18, 0.34);
      }

      h1 {
        margin: 0 0 1rem;
        font-size: clamp(2rem, 6vw, 4rem);
      }

      p {
        margin: 0;
        font-size: 1.05rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Multi Service Backoffice</h1>
      <p>Secondary route is alive.</p>
    </main>
  </body>
</html>`);
});

server.listen(port);
