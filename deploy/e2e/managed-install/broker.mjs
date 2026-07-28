import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { dirname } from 'node:path';

const allocationPath = '/v1/managed-domains/allocations';
const brokerBaseDomain = normalizeName(readRequiredEnvironment('MANAGED_DOMAIN_BASE_DOMAIN'));
const challengeServerUrl = new URL(readRequiredEnvironment('MANAGED_DOMAIN_CHALLENGE_SERVER_URL'));
const reservationToken = readRequiredEnvironment('MANAGED_DOMAIN_RESERVATION_TOKEN');
const statePath = readRequiredEnvironment('MANAGED_DOMAIN_STATE_PATH');
const port = Number(process.env.PORT ?? '3000');
const state = await readPersistedState();
let persistenceQueue = Promise.resolve();

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    writeJson(response, 400, { error: error instanceof Error ? error.message : 'managed-domain fixture failed' });
  }
});

await replayPersistedDesiredState();
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`managed-domain broker fixture listening on :${port.toString()}\n`);
});

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? '/', 'http://managed-domain-broker');
  if (request.method === 'GET' && requestUrl.pathname === '/readyz') {
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/__test/state') {
    writeJson(response, 200, publicState());
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === allocationPath) {
    await reserveAllocation(request, response);
    return;
  }
  const match = requestUrl.pathname.match(
    /^\/v1\/managed-domains\/allocations\/([^/]+)\/(targets|challenges|replay)$/u,
  );
  if (match !== null) {
    const allocation = state.allocations.find((entry) => entry.allocationId === decodeURIComponent(match[1]));
    if (!authorizeAllocation(request, response, allocation)) {
      return;
    }
    if (match[2] === 'targets' && request.method === 'PUT') {
      await bindTargets(request, response, allocation);
      return;
    }
    if (match[2] === 'challenges' && (request.method === 'POST' || request.method === 'DELETE')) {
      await updateChallenge(request, response, allocation);
      return;
    }
    if (match[2] === 'replay' && request.method === 'POST') {
      await replayAllocation(response, allocation);
      return;
    }
  }
  writeJson(response, 404, { error: 'not found' });
}

async function reserveAllocation(request, response) {
  if (request.headers.authorization !== `Bearer ${reservationToken}`) {
    writeJson(response, 401, { error: 'reservation authorization is required' });
    return;
  }
  const body = await readJsonBody(request);
  assertReservationRequest(body);
  if (request.headers['idempotency-key'] !== body.installationId) {
    writeJson(response, 400, { error: 'Idempotency-Key must match installationId' });
    return;
  }
  const requestedLabel = normalizeRequestedLabel(body.requestedLabelSource);
  let allocation = state.allocations.find((entry) => entry.installationId === body.installationId);
  if (allocation !== undefined && allocation.requestedLabel !== requestedLabel) {
    writeJson(response, 409, { error: 'installation already owns a different allocation' });
    return;
  }
  const labelOwner = state.allocations.find((entry) => entry.requestedLabel === requestedLabel);
  if (labelOwner !== undefined && labelOwner.installationId !== body.installationId) {
    writeJson(response, 409, { error: 'requested label is already reserved' });
    return;
  }
  if (allocation === undefined) {
    allocation = {
      allocationId: randomUUID(),
      baseDomain: `${requestedLabel}.${brokerBaseDomain}`,
      challenges: [],
      installationId: body.installationId,
      requestedLabel,
      requestedLabelSource: body.requestedLabelSource,
      scopedToken: randomBytes(24).toString('base64url'),
      targets: [],
    };
    state.allocations.push(allocation);
    state.audit.push({ allocationId: allocation.allocationId, event: 'allocation_reserved' });
    await persistState();
  }
  writeJson(response, 201, {
    allocationId: allocation.allocationId,
    baseDomain: allocation.baseDomain,
    scopedToken: allocation.scopedToken,
  });
}

async function bindTargets(request, response, allocation) {
  const body = await readJsonBody(request);
  if (!isRecord(body) || !Array.isArray(body.targets) || body.targets.length === 0) {
    throw new Error('targets must be a non-empty array');
  }
  const targets = body.targets.map(validateTarget);
  allocation.targets = targets;
  state.audit.push({ allocationId: allocation.allocationId, event: 'targets_bound', targets });
  await persistState();
  await clearTargetDns(allocation);
  await applyTargetDns(allocation);
  writeJson(response, 200, { allocationId: allocation.allocationId, targets });
}

async function updateChallenge(request, response, allocation) {
  const body = await readJsonBody(request);
  if (!isRecord(body) || !hasText(body.name) || !hasText(body.value)) {
    throw new Error('name and value are required');
  }
  const name = normalizeName(body.name);
  if (!name.startsWith('_acme-challenge.') || !name.endsWith(`.${normalizeName(allocation.baseDomain)}`)) {
    writeJson(response, 403, { error: 'challenge name is outside the allocation zone' });
    return;
  }
  const challenge = { name, value: body.value };
  if (request.method === 'POST') {
    if (!allocation.challenges.some((entry) => entry.name === name && entry.value === body.value)) {
      allocation.challenges.push(challenge);
    }
    state.audit.push({ allocationId: allocation.allocationId, event: 'challenge_presented', ...challenge });
    await persistState();
    await updateChallengeDns('POST', challenge);
    writeJson(response, 201, challenge);
    return;
  }
  allocation.challenges = allocation.challenges.filter(
    (entry) => entry.name !== challenge.name || entry.value !== challenge.value,
  );
  state.audit.push({ allocationId: allocation.allocationId, event: 'challenge_cleaned', ...challenge });
  await persistState();
  await updateChallengeDns('DELETE', challenge);
  response.writeHead(204).end();
}

async function replayAllocation(response, allocation) {
  await applyTargetDns(allocation);
  for (const challenge of allocation.challenges) {
    await updateChallengeDns('POST', challenge);
  }
  state.replayCount += 1;
  state.audit.push({ allocationId: allocation.allocationId, event: 'desired_state_replayed' });
  await persistState();
  writeJson(response, 200, {
    allocationId: allocation.allocationId,
    challengeCount: allocation.challenges.length,
    targetCount: allocation.targets.length,
  });
}

async function replayPersistedDesiredState() {
  for (const allocation of state.allocations) {
    await applyTargetDns(allocation);
    for (const challenge of allocation.challenges) {
      await updateChallengeDns('POST', challenge);
    }
  }
  if (state.allocations.length > 0) {
    state.replayCount += 1;
    state.audit.push({ event: 'startup_desired_state_replayed' });
    await persistState();
  }
}

async function readPersistedState() {
  try {
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    if (
      !isRecord(persisted) ||
      !Array.isArray(persisted.allocations) ||
      !Array.isArray(persisted.audit) ||
      !Number.isInteger(persisted.replayCount)
    ) {
      throw new Error('Persisted managed-domain broker state is malformed.');
    }
    return persisted;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return { allocations: [], audit: [], replayCount: 0 };
    }
    throw error;
  }
}

function persistState() {
  const persist = async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid.toString()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600 });
    await rename(temporaryPath, statePath);
  };
  persistenceQueue = persistenceQueue.then(persist, persist);
  return persistenceQueue;
}

function authorizeAllocation(request, response, allocation) {
  if (allocation === undefined) {
    writeJson(response, 404, { error: 'allocation not found' });
    return false;
  }
  if (request.headers.authorization !== `Bearer ${allocation.scopedToken}`) {
    state.audit.push({
      allocationId: allocation.allocationId,
      event: 'authority_denied',
      reason: 'allocation_token_mismatch',
    });
    writeJson(response, 403, { error: 'token is not authorized for this allocation' });
    return false;
  }
  return true;
}

function validateTarget(target) {
  if (!isRecord(target) || !['A', 'AAAA', 'hostname'].includes(target.type) || !hasText(target.value)) {
    throw new Error('Each target requires type A, AAAA, or hostname and a value.');
  }
  if (target.type === 'A' && isIP(target.value) !== 4) {
    throw new Error('Invalid A target.');
  }
  if (target.type === 'AAAA' && isIP(target.value) !== 6) {
    throw new Error('Invalid AAAA target.');
  }
  if (target.type === 'hostname') {
    const hostname = normalizeName(target.value);
    if (
      isIP(hostname) !== 0 ||
      hostname.length > 253 ||
      !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    ) {
      throw new Error('Hostname target must remain a valid hostname.');
    }
    return { type: target.type, value: hostname };
  }
  return { type: target.type, value: target.value };
}

async function applyTargetDns(allocation) {
  const ipv4 = allocation.targets.filter((target) => target.type === 'A').map((target) => target.value);
  const ipv6 = allocation.targets.filter((target) => target.type === 'AAAA').map((target) => target.value);
  const hostname = allocation.targets.find((target) => target.type === 'hostname');
  if (ipv4.length > 0) {
    await challengeRequest('/add-a', { addresses: ipv4, host: `a.${allocation.baseDomain}` });
  }
  if (ipv6.length > 0) {
    await challengeRequest('/add-aaaa', { addresses: ipv6, host: `aaaa.${allocation.baseDomain}` });
  }
  if (hostname !== undefined) {
    await challengeRequest('/set-cname', {
      host: `hostname.${allocation.baseDomain}`,
      target: normalizeName(hostname.value),
    });
  }
}

async function clearTargetDns(allocation) {
  await challengeRequest('/clear-a', { host: `a.${allocation.baseDomain}` });
  await challengeRequest('/clear-aaaa', { host: `aaaa.${allocation.baseDomain}` });
  await challengeRequest('/clear-cname', { host: `hostname.${allocation.baseDomain}` });
}

async function updateChallengeDns(method, record) {
  await challengeRequest(method === 'POST' ? '/set-txt' : '/clear-txt', {
    host: `${record.name}.`,
    value: record.value,
  });
}

async function challengeRequest(path, body) {
  const endpoint = new URL(path, challengeServerUrl);
  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`challtestsrv ${path} failed with status ${response.status.toString()}`);
  }
}

function assertReservationRequest(body) {
  if (!isRecord(body) || !hasText(body.installationId) || !hasText(body.requestedLabelSource) || 'publicIp' in body) {
    throw new Error('Invalid managed-domain reservation request.');
  }
}

function normalizeRequestedLabel(value) {
  const label = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 63)
    .replace(/-+$/gu, '');
  if (label === '') {
    throw new Error('requestedLabelSource must produce a DNS label.');
  }
  return label;
}

function publicState() {
  return {
    allocations: state.allocations.map((allocation) => {
      const publicAllocation = { ...allocation };
      delete publicAllocation.scopedToken;
      return publicAllocation;
    }),
    audit: state.audit,
    replayCount: state.replayCount,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new Error('Managed-domain broker request is too large.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function readRequiredEnvironment(name) {
  const value = process.env[name];
  if (!hasText(value)) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function normalizeName(value) {
  return value.trim().toLowerCase().replace(/\.$/u, '');
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
