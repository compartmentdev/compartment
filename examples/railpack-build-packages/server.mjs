import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const jqVersion = readJqVersion();

console.log('railpack-build-packages booting');
console.log(`railpack-build-packages listening on ${port}`);
console.log(`railpack-build-packages jq ${jqVersion}`);

const server = createServer((request, response) => {
  if (request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jqVersion, status: 'ok' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ jqVersion, service: 'railpack-build-packages', status: 'ok' }));
});

server.listen(port);

function readJqVersion() {
  const result = spawnSync('jq', ['--version'], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`jq --version failed: ${result.stderr.trim()}`);
  }

  return result.stdout.trim();
}
