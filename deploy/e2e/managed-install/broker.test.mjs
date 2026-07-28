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
const reservationToken = 'fixture-reservation-token';

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
  it('enforces reservation and allocation scope before projecting and replaying typed desired DNS state', async () => {
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

    const brokerPort = 23000 + Math.floor(Math.random() * 1000);
    const stateDirectory = await mkdtemp(join(tmpdir(), 'managed-domain-broker-'));
    temporaryDirectories.push(stateDirectory);
    const brokerEnvironment = {
      ...process.env,
      MANAGED_DOMAIN_BASE_DOMAIN: 'managed.example.test',
      MANAGED_DOMAIN_CHALLENGE_SERVER_URL: `http://127.0.0.1:${dnsAddress.port.toString()}`,
      MANAGED_DOMAIN_RESERVATION_TOKEN: reservationToken,
      MANAGED_DOMAIN_STATE_PATH: join(stateDirectory, 'broker.json'),
      PORT: brokerPort.toString(),
    };
    let broker = spawn(process.execPath, [resolve('deploy/e2e/managed-install/broker.mjs')], {
      cwd: resolve('.'),
      env: brokerEnvironment,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    processes.push(broker);
    await once(broker.stdout, 'data');
    const brokerUrl = `http://127.0.0.1:${brokerPort.toString()}`;

    const unauthorized = await reserveResponse(brokerUrl, 'install-1', 'one', 'wrong-token');
    expect(unauthorized.status).toBe(401);

    const first = await reserve(brokerUrl, 'install-1', 'One');
    const second = await reserve(brokerUrl, 'install-2', 'Two');
    expect(first.baseDomain).toBe('one.managed.example.test');
    expect(second.baseDomain).toBe('two.managed.example.test');

    const reacquisition = await reserveResponse(brokerUrl, 'install-1', 'One', 'wrong-token');
    expect(reacquisition.status).toBe(401);

    const targets = [
      { type: 'A', value: '1.2.3.4' },
      { type: 'AAAA', value: '2001:db8::1' },
      { type: 'hostname', value: 'Shared-LB.Example.com.' },
    ];
    const bound = await allocationRequest(brokerUrl, first, 'targets', 'PUT', { targets });
    expect(bound.status).toBe(200);
    await expect(bound.json()).resolves.toMatchObject({
      targets: [
        { type: 'A', value: '1.2.3.4' },
        { type: 'AAAA', value: '2001:db8::1' },
        { type: 'hostname', value: 'shared-lb.example.com' },
      ],
    });
    expect(dnsWrites.slice(-3)).toEqual([
      { path: '/add-a', body: { addresses: ['1.2.3.4'], host: 'a.one.managed.example.test' } },
      { path: '/add-aaaa', body: { addresses: ['2001:db8::1'], host: 'aaaa.one.managed.example.test' } },
      {
        path: '/set-cname',
        body: { host: 'hostname.one.managed.example.test', target: 'shared-lb.example.com' },
      },
    ]);

    const challenge = { name: `_acme-challenge.${first.baseDomain}`, value: 'wildcard-proof' };
    const beforeDenied = dnsWrites.length;
    const wrongToken = await fetch(`${brokerUrl}/v1/managed-domains/allocations/${first.allocationId}/challenges`, {
      body: JSON.stringify(challenge),
      headers: { authorization: `Bearer ${second.scopedToken}`, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(wrongToken.status).toBe(403);
    const outOfZone = await allocationRequest(brokerUrl, first, 'challenges', 'POST', {
      name: `_acme-challenge.${second.baseDomain}`,
      value: 'cross-zone-proof',
    });
    expect(outOfZone.status).toBe(403);
    expect(dnsWrites).toHaveLength(beforeDenied);

    const presented = await allocationRequest(brokerUrl, first, 'challenges', 'POST', challenge);
    expect(presented.status).toBe(201);
    const concurrentChallenges = await Promise.all([
      allocationRequest(brokerUrl, first, 'challenges', 'POST', { ...challenge, value: 'concurrent-proof-1' }),
      allocationRequest(brokerUrl, first, 'challenges', 'POST', { ...challenge, value: 'concurrent-proof-2' }),
    ]);
    expect(concurrentChallenges.map((response) => response.status)).toEqual([201, 201]);
    const beforeReplay = dnsWrites.length;
    const replayed = await allocationRequest(brokerUrl, first, 'replay', 'POST');
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({ challengeCount: 3, targetCount: 3 });
    expect(dnsWrites.slice(beforeReplay).map((write) => write.path)).toEqual([
      '/add-a',
      '/add-aaaa',
      '/set-cname',
      '/set-txt',
      '/set-txt',
      '/set-txt',
    ]);

    broker.kill('SIGTERM');
    await once(broker, 'exit');
    processes.splice(processes.indexOf(broker), 1);
    const beforeRestart = dnsWrites.length;
    broker = spawn(process.execPath, [resolve('deploy/e2e/managed-install/broker.mjs')], {
      cwd: resolve('.'),
      env: brokerEnvironment,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    processes.push(broker);
    await once(broker.stdout, 'data');
    expect(dnsWrites.slice(beforeRestart).map((write) => write.path)).toEqual([
      '/add-a',
      '/add-aaaa',
      '/set-cname',
      '/set-txt',
      '/set-txt',
      '/set-txt',
    ]);
    const replayAfterRestart = await allocationRequest(brokerUrl, first, 'replay', 'POST');
    expect(replayAfterRestart.status).toBe(200);

    const stateResponse = await fetch(`${brokerUrl}/__test/state`);
    const state = await stateResponse.json();
    expect(state.allocations[0].targets[2]).toEqual({
      type: 'hostname',
      value: 'shared-lb.example.com',
    });
    expect(JSON.stringify(state)).not.toContain(first.scopedToken);
  });
});

async function reserve(brokerUrl, installationId, requestedLabelSource) {
  const response = await reserveResponse(brokerUrl, installationId, requestedLabelSource, reservationToken);
  expect(response.status).toBe(201);
  return await response.json();
}

async function reserveResponse(brokerUrl, installationId, requestedLabelSource, token) {
  return await fetch(`${brokerUrl}/v1/managed-domains/allocations`, {
    body: JSON.stringify({ installationId, requestedLabelSource }),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': installationId,
    },
    method: 'POST',
  });
}

async function allocationRequest(brokerUrl, allocation, suffix, method, body) {
  return await fetch(`${brokerUrl}/v1/managed-domains/allocations/${allocation.allocationId}/${suffix}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      authorization: `Bearer ${allocation.scopedToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    method,
  });
}
