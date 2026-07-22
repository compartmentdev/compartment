import { createServer } from 'node:http';

const allocationPath = '/v1/managed-domains';
const txtPath = '/v1/managed-domains/acme-dns/txt';
const baseDomain = readRequiredEnvironment('MANAGED_DOMAIN_BASE_DOMAIN');
const brokerToken = readRequiredEnvironment('MANAGED_DOMAIN_BROKER_TOKEN');
const challengeServerUrl = new URL(readRequiredEnvironment('MANAGED_DOMAIN_CHALLENGE_SERVER_URL'));
const state = {
  allocations: [],
  txtDeletes: [],
  txtWrites: [],
};

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    writeJson(response, 500, { error: 'managed-domain fixture failed' });
  }
});

server.listen(3000, '0.0.0.0', () => process.stdout.write('managed-domain broker fixture listening on :3000\n'));

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? '/', 'http://managed-domain-broker');
  if (request.method === 'GET' && requestUrl.pathname === '/readyz') {
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/__test/state') {
    writeJson(response, 200, state);
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === allocationPath) {
    const body = await readJsonBody(request);
    assertAllocationRequest(body);
    assertAllocationIdempotencyKey(request, body);
    if (!state.allocations.some((allocation) => allocation.installationId === body.installationId)) {
      state.allocations.push(body);
    }
    writeJson(response, 201, { acmeDnsToken: brokerToken, baseDomain });
    return;
  }
  if ((request.method === 'PUT' || request.method === 'DELETE') && requestUrl.pathname === txtPath) {
    assertAuthorization(request);
    const body = await readJsonBody(request);
    assertTxtRequest(body);
    await updateChallengeDns(request.method, body);
    (request.method === 'PUT' ? state.txtWrites : state.txtDeletes).push(body);
    response.writeHead(204).end();
    return;
  }
  writeJson(response, 404, { error: 'not found' });
}

async function updateChallengeDns(method, record) {
  const endpoint = new URL(method === 'PUT' ? '/set-txt' : '/clear-txt', challengeServerUrl);
  const body = method === 'PUT' ? record : { host: record.name };
  const response = await fetch(endpoint, {
    body: JSON.stringify({ host: body.name ?? body.host, ...(body.value === undefined ? {} : { value: body.value }) }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`challtestsrv ${endpoint.pathname} failed with status ${response.status.toString()}`);
  }
}

function assertAllocationRequest(body) {
  if (
    !isRecord(body) ||
    !hasText(body.installationId) ||
    !hasText(body.publicIp) ||
    !hasText(body.requestedLabelSource)
  ) {
    throw new Error('Invalid managed-domain allocation request.');
  }
}

function assertAllocationIdempotencyKey(request, body) {
  if (request.headers['idempotency-key'] !== body.installationId) {
    throw new Error('Managed-domain allocation idempotency key must match installationId.');
  }
}

function assertTxtRequest(body) {
  if (!isRecord(body) || !hasText(body.name) || !hasText(body.value)) {
    throw new Error('Invalid managed-domain TXT request.');
  }
  if (!body.name.endsWith(`.${baseDomain}.`) || !body.name.startsWith('_acme-challenge.')) {
    throw new Error(`TXT name is outside the allocated challenge scope: ${body.name}`);
  }
}

function assertAuthorization(request) {
  if (request.headers.authorization !== `Bearer ${brokerToken}`) {
    throw new Error('Invalid managed-domain broker authorization.');
  }
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

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
