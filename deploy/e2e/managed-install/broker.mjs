import { randomBytes } from 'node:crypto';
import { Resolver, lookup } from 'node:dns/promises';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { dirname } from 'node:path';

const managedDomainPath = '/v1/managed-domains';
const acmeDnsTxtPath = '/v1/managed-domains/acme-dns/txt';
const brokerBaseDomain = normalizeName(readRequiredEnvironment('MANAGED_DOMAIN_BASE_DOMAIN'));
const challengeServerUrl = new URL(readRequiredEnvironment('MANAGED_DOMAIN_CHALLENGE_SERVER_URL'));
const publicDnsServerHost = readRequiredEnvironment('MANAGED_DOMAIN_PUBLIC_DNS_SERVER');
const statePath = readRequiredEnvironment('MANAGED_DOMAIN_STATE_PATH');
const port = Number(process.env.PORT ?? '3000');
const dnsQueryTimeoutMs = 1_000;
const dnsQueryTries = 2;
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
    const baseDomain = `${requestedLabel}.${brokerBaseDomain}`;
    const publicHostname = `console.${baseDomain}`;
    const publicDnsResolver = await createPublicDnsResolver();
    const challengeName = `_acme-challenge.${baseDomain}`;
    const resolvePublishedAddress =
      ipVersion === 4
        ? () => publicDnsResolver.resolve4(publicHostname)
        : () => publicDnsResolver.resolve6(publicHostname);
    await assertDnsNameMissing(
      resolvePublishedAddress,
      `Managed public hostname ${publicHostname} resolved before the broker published it.`,
    );
    await assertDnsNameMissing(
      () => publicDnsResolver.resolveTxt(challengeName),
      `Managed challenge ${challengeName} resolved before cert-manager presented it.`,
    );
    allocation = {
      acmeDnsToken: randomBytes(24).toString('base64url'),
      baseDomain,
      txtRecords: [],
      installationId: body.installationId,
      publicIp: body.publicIp,
      requestedLabel,
      requestedLabelSource: body.requestedLabelSource,
      targets: [{ type: ipVersion === 4 ? 'A' : 'AAAA', value: body.publicIp }],
    };
    state.managedDomains.push(allocation);
    state.audit.push({ event: 'domain_initially_unresolved', name: publicHostname });
    state.audit.push({ event: 'challenge_initially_unresolved', name: challengeName });
    state.audit.push({ event: 'domain_allocated', installationId: body.installationId });
    await persistState();
    await publishAllocationAddresses(allocation);
    state.audit.push({ event: 'domain_published_after_initial_nxdomain', name: publicHostname });
    await persistState();
  } else {
    await publishAllocationAddresses(allocation);
  }
  writeJson(response, 200, {
    acmeDnsToken: allocation.acmeDnsToken,
    baseDomain: allocation.baseDomain,
  });
}

async function publishAllocationAddresses(allocation) {
  const recordPath = isIP(allocation.publicIp) === 4 ? '/add-a' : '/add-aaaa';
  for (const host of [allocation.baseDomain, `console.${allocation.baseDomain}`]) {
    await challengeRequest(recordPath, { addresses: [allocation.publicIp], host });
  }
}

async function createPublicDnsResolver() {
  const resolver = new Resolver({ timeout: dnsQueryTimeoutMs, tries: dnsQueryTries });
  const directServerMatch = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/u.exec(publicDnsServerHost);
  if (directServerMatch !== null && isIP(directServerMatch[1]) === 4) {
    resolver.setServers([publicDnsServerHost]);
    return resolver;
  }
  const dnsServer = await lookup(publicDnsServerHost, { family: 4 });
  resolver.setServers([dnsServer.address]);
  return resolver;
}

async function assertDnsNameMissing(resolveName, resolvedErrorMessage) {
  try {
    await resolveName();
  } catch (error) {
    if (isDnsNameMissingError(error)) {
      return;
    }
    throw error;
  }
  throw new Error(resolvedErrorMessage);
}

function isDnsNameMissingError(error) {
  return isRecord(error) && (error.code === 'ENODATA' || error.code === 'ENOTFOUND');
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
