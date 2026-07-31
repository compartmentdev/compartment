import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { dirname } from 'node:path';

const managedDomainPath = '/v1/managed-domains';
const acmeDnsTxtPath = '/v1/managed-domains/acme-dns/txt';
const brokerBaseDomain = normalizeName(readRequiredEnvironment('MANAGED_DOMAIN_BASE_DOMAIN'));
const challengeServerUrl = new URL(readRequiredEnvironment('MANAGED_DOMAIN_CHALLENGE_SERVER_URL'));
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
  if (request.method === 'POST' && requestUrl.pathname === managedDomainPath) {
    await allocateDomain(request, response);
    return;
  }
  if ((request.method === 'PUT' || request.method === 'DELETE') && requestUrl.pathname === acmeDnsTxtPath) {
    await updateTxtRecord(request, response);
    return;
  }
  writeJson(response, 404, { error: 'not found' });
}

async function allocateDomain(request, response) {
  if (request.headers.authorization !== undefined) {
    writeJson(response, 400, { error: 'managed-domain allocation must not use authorization' });
    return;
  }
  const body = await readJsonBody(request);
  assertAllocationRequest(body);
  const requestedLabel = normalizeRequestedLabel(body.requestedLabelSource);
  let allocation = state.managedDomains.find((entry) => entry.installationId === body.installationId);
  if (
    allocation !== undefined &&
    (allocation.requestedLabel !== requestedLabel || allocation.publicIp !== body.publicIp)
  ) {
    writeJson(response, 409, { error: 'installation already owns a different managed domain' });
    return;
  }
  if (allocation === undefined) {
    const ipVersion = isIP(body.publicIp);
    allocation = {
      acmeDnsToken: randomBytes(24).toString('base64url'),
      baseDomain: `${requestedLabel}.${brokerBaseDomain}`,
      txtRecords: [],
      installationId: body.installationId,
      publicIp: body.publicIp,
      requestedLabel,
      requestedLabelSource: body.requestedLabelSource,
      targets: [{ type: ipVersion === 4 ? 'A' : 'AAAA', value: body.publicIp }],
    };
    state.managedDomains.push(allocation);
    state.audit.push({ event: 'domain_allocated', installationId: body.installationId });
    await persistState();
    await challengeRequest(ipVersion === 4 ? '/add-a' : '/add-aaaa', {
      addresses: [body.publicIp],
      host: allocation.baseDomain,
    });
  }
  writeJson(response, 200, {
    acmeDnsToken: allocation.acmeDnsToken,
    baseDomain: allocation.baseDomain,
  });
}

async function updateTxtRecord(request, response) {
  const allocation = state.managedDomains.find(
    (entry) => request.headers.authorization === `Bearer ${entry.acmeDnsToken}`,
  );
  if (allocation === undefined) {
    writeJson(response, 403, { error: 'invalid acme-dns token' });
    return;
  }
  const body = await readJsonBody(request);
  if (!isRecord(body) || !hasText(body.name) || !hasText(body.value)) {
    throw new Error('name and value are required');
  }
  const name = normalizeName(body.name);
  const expectedName = `_acme-challenge.${normalizeName(allocation.baseDomain)}`;
  if (name !== expectedName) {
    writeJson(response, 403, { error: 'challenge name is outside the allocated zone' });
    return;
  }
  const challenge = { name, value: body.value };
  if (request.method === 'PUT') {
    if (!allocation.txtRecords.some((entry) => entry.name === name && entry.value === body.value)) {
      allocation.txtRecords.push(challenge);
    }
    state.audit.push({ event: 'challenge_presented', ...challenge });
    await challengeRequest('/set-txt', { host: `${name}.`, value: body.value });
  } else {
    allocation.txtRecords = allocation.txtRecords.filter(
      (entry) => entry.name !== challenge.name || entry.value !== challenge.value,
    );
    state.audit.push({ event: 'challenge_cleaned', ...challenge });
    await challengeRequest('/clear-txt', { host: `${name}.`, value: body.value });
  }
  await persistState();
  response.writeHead(204).end();
}

async function readPersistedState() {
  try {
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    if (!isRecord(persisted) || !Array.isArray(persisted.managedDomains) || !Array.isArray(persisted.audit)) {
      throw new Error('Persisted managed-domain broker state is malformed.');
    }
    return persisted;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return { managedDomains: [], audit: [] };
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

async function challengeRequest(path, body) {
  const response = await fetch(new URL(path, challengeServerUrl), {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`challtestsrv ${path} failed with status ${response.status.toString()}`);
  }
}

function assertAllocationRequest(body) {
  if (
    !isRecord(body) ||
    !hasText(body.installationId) ||
    !hasText(body.publicIp) ||
    isIP(body.publicIp) === 0 ||
    !hasText(body.requestedLabelSource)
  ) {
    throw new Error('Invalid managed-domain allocation request.');
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
    managedDomains: state.managedDomains.map((entry) => {
      const allocation = { ...entry };
      delete allocation.acmeDnsToken;
      return allocation;
    }),
    audit: state.audit,
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
