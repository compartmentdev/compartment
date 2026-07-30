import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const processes = [];
const servers = [];
const temporaryDirectories = [];

afterEach(async () => {
  for (const process of processes.splice(0)) {
    if (process.exitCode === null) {
      process.kill('SIGTERM');
      await once(process, 'exit');
    }
  }
  for (const server of servers.splice(0)) {
    server.close();
    await once(server, 'close');
  }
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe('managed-install broker contract fixture', () => {
  it('allocates with one unauthenticated POST using publicIp', async () => {
    const fixture = await startFixture();
    const response = await fetch(`${fixture.brokerUrl}/v1/managed-domains`, {
      body: JSON.stringify({
        installationId: 'install-main-contract',
        publicIp: '1.2.3.4',
        requestedLabelSource: 'Main Contract',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acmeDnsToken: expect.any(String),
      baseDomain: 'main-contract.managed.example.test',
    });
    expect(fixture.dnsWrites).toContainEqual({
      body: { addresses: ['1.2.3.4'], host: 'main-contract.managed.example.test' },
      path: '/add-a',
    });
  });

  it('uses PUT and DELETE acme-dns TXT requests with Bearer authorization and 204 responses', async () => {
    const fixture = await startFixture();
    const allocationResponse = await fetch(`${fixture.brokerUrl}/v1/managed-domains`, {
      body: JSON.stringify({
        installationId: 'install-dns01',
        publicIp: '2001:db8::1',
        requestedLabelSource: 'dns01',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const allocation = await allocationResponse.json();
    const challenge = { name: `_acme-challenge.${allocation.baseDomain}`, value: 'proof-value' };

    for (const method of ['PUT', 'DELETE']) {
      const response = await fetch(`${fixture.brokerUrl}/v1/managed-domains/acme-dns/txt`, {
        body: JSON.stringify(challenge),
        headers: {
          authorization: `Bearer ${allocation.acmeDnsToken}`,
          'content-type': 'application/json',
        },
        method,
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    }
    expect(fixture.dnsWrites.slice(-2)).toEqual([
      { body: { host: `_acme-challenge.${allocation.baseDomain}.`, value: 'proof-value' }, path: '/set-txt' },
      { body: { host: `_acme-challenge.${allocation.baseDomain}.`, value: 'proof-value' }, path: '/clear-txt' },
    ]);
  });
});

async function startFixture() {
  const dnsWrites = [];
  const dnsServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    dnsWrites.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    response.writeHead(204).end();
  });
  servers.push(dnsServer);
  dnsServer.listen(0, '127.0.0.1');
  await once(dnsServer, 'listening');
  const dnsAddress = dnsServer.address();
  if (typeof dnsAddress === 'string' || dnsAddress === null) {
    throw new Error('Expected DNS fixture TCP address.');
  }

  const stateDirectory = await mkdtemp(join(tmpdir(), 'managed-domain-broker-'));
  temporaryDirectories.push(stateDirectory);
  const brokerPort = 23000 + Math.floor(Math.random() * 1000);
  const broker = spawn(process.execPath, [resolve('deploy/e2e/managed-install/broker.mjs')], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      MANAGED_DOMAIN_BASE_DOMAIN: 'managed.example.test',
      MANAGED_DOMAIN_CHALLENGE_SERVER_URL: `http://127.0.0.1:${dnsAddress.port.toString()}`,
      MANAGED_DOMAIN_STATE_PATH: join(stateDirectory, 'broker.json'),
      PORT: brokerPort.toString(),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  processes.push(broker);
  await once(broker.stdout, 'data');
  return { brokerUrl: `http://127.0.0.1:${brokerPort.toString()}`, dnsWrites };
}
