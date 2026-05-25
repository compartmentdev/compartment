import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const environmentName = process.env.COMPARTMENT_ENVIRONMENT ?? 'unknown';

console.log('dockerfile booting');
console.log(`dockerfile listening on ${port}`);

const server = createServer((request, response) => {
  if (request.url === '/healthz') {
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
    <title>Dockerfile</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Georgia", "Times New Roman", serif;
        background: linear-gradient(135deg, #f4efe4 0%, #f0dcc0 100%);
        color: #24170f;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }

      main {
        padding: 3rem;
        border: 1px solid rgba(36, 23, 15, 0.12);
        background: rgba(255, 250, 243, 0.88);
        box-shadow: 0 20px 60px rgba(36, 23, 15, 0.12);
      }

      h1 {
        margin: 0 0 1rem;
        font-size: clamp(2rem, 6vw, 4rem);
      }

      p {
        margin: 0;
        font-size: 1.1rem;
      }

      .meta {
        margin-top: 0.75rem;
        color: rgba(36, 23, 15, 0.72);
        font-size: 0.95rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Dockerfile</h1>
      <p>Deployment path is alive.</p>
      <p class="meta">Environment: ${environmentName}</p>
    </main>
  </body>
</html>`);
});

server.listen(port);

function readHeader(value) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
