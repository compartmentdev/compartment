import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const fixturePath = resolve(process.cwd(), 'scripts/deploy/fixtures/cosign-k3d-e2e.mjs');
const digest = 'sha256:' + 'a'.repeat(64);
let server;

describe('k3d cosign fixture', () => {
  afterEach(async () => {
    if (server !== undefined) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      });
      server = undefined;
    }
  });

  it('returns the pinned digest without contacting a registry', async () => {
    const result = await runFixture('k3d-test:15500/compartment-api@' + digest);
    expect(readVerifiedDigest(result.stdout)).toBe(digest);
  });

  it('resolves a k3d tag to the digest returned by the local registry', async () => {
    server = createServer((request, response) => {
      expect(request.url).toBe('/v2/compartment-api/manifests/e2e');
      response.setHeader('docker-content-digest', digest);
      response.end('{}');
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a local registry fixture port.');
    }
    const result = await runFixture('k3d-test:' + address.port.toString() + '/compartment-api:e2e');
    expect(readVerifiedDigest(result.stdout)).toBe(digest);
  });
});

async function runFixture(imageRef) {
  return await execFileAsync(process.execPath, [fixturePath, 'verify', '--output', 'json', imageRef]);
}

function readVerifiedDigest(output) {
  return JSON.parse(output)[0].critical.image['docker-manifest-digest'];
}
