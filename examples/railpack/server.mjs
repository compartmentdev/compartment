import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

console.log('railpack booting');
console.log(`railpack listening on ${port}`);

const server = createServer((request, response) => {
  if (request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (request.url === '/__example_probe') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        cookie: request.headers.cookie ?? null,
        compartmentHeaders: {
          accessMode: readHeader(request.headers['x-compartment-access-mode']),
          organizationId: readHeader(request.headers['x-compartment-organization-id']),
          organizationSlug: readHeader(request.headers['x-compartment-organization-slug']),
          principalEmail: readHeader(request.headers['x-compartment-principal-email']),
          principalId: readHeader(request.headers['x-compartment-principal-id']),
          principalType: readHeader(request.headers['x-compartment-principal-type']),
          role: readHeader(request.headers['x-compartment-role']),
          upstreamPort: readHeader(request.headers['x-compartment-upstream-port']),
        },
      }),
    );
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Railpack</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Trebuchet MS", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(255, 215, 170, 0.7), transparent 35%),
          linear-gradient(160deg, #14213d 0%, #223b68 55%, #1e2f56 100%);
        color: #f7f4ef;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }

      main {
        padding: 3rem;
        border: 1px solid rgba(247, 244, 239, 0.16);
        background: rgba(10, 18, 36, 0.62);
        box-shadow: 0 24px 80px rgba(5, 10, 20, 0.35);
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
      <h1>Railpack</h1>
      <p>Railpack deployment path is alive.</p>
    </main>
  </body>
</html>`);
});

server.listen(port);

function readHeader(value) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
