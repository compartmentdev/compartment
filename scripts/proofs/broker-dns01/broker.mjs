import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const statePath = process.env.STATE_PATH ?? '/state/state.json';
const testZone = normalizeName(requiredEnvironment('TEST_ZONE'));
const challengeServerUrl = new URL(requiredEnvironment('CHALLENGE_SERVER_URL'));
const reservationToken = requiredEnvironment('RESERVATION_TOKEN');
const proofControlToken = requiredEnvironment('PROOF_CONTROL_TOKEN');
const state = await loadState();

await replayDesiredState('startup');

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    writeJson(response, 500, { error: 'proof broker failed' });
  }
});

server.listen(3000, '0.0.0.0', () => {
  process.stdout.write(`broker_ready allocations=${state.allocations.length} replayCount=${state.replayCount}\n`);
});

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? '/', 'http://broker.proof.svc');
  if (request.method === 'GET' && requestUrl.pathname === '/readyz') {
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/__proof/state') {
    if (!authorizeProofControl(request, response)) {
      return;
    }
    writeJson(response, 200, publicState());
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/__proof/dns-history') {
    if (!authorizeProofControl(request, response)) {
      return;
    }
    const host = requestUrl.searchParams.get('host');
    if (!hasText(host)) {
      writeJson(response, 400, { error: 'host is required' });
      return;
    }
    writeJson(response, 200, await readDnsHistory(host));
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/__proof/clear-backend') {
    if (!authorizeProofControl(request, response)) {
      return;
    }
    await clearBackendWithoutChangingDesiredState();
    audit('backend_cleared', {});
    writeJson(response, 200, { cleared: true });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/__proof/restart') {
    if (!authorizeProofControl(request, response)) {
      return;
    }
    response.writeHead(202).end();
    setTimeout(() => process.exit(75), 50);
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/allocations') {
    await reserveAllocation(request, response);
    return;
  }
  const match = requestUrl.pathname.match(/^\/allocations\/([^/]+)\/(targets|challenges)$/);
  if (match !== null) {
    const allocation = findAllocation(decodeURIComponent(match[1]));
    if (!authorize(request, response, allocation)) {
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
  }
  writeJson(response, 404, { error: 'not found' });
}

async function reserveAllocation(request, response) {
  if (request.headers.authorization !== `Bearer ${reservationToken}`) {
    writeJson(response, 401, { error: 'reservation authorization is required' });
    return;
  }
  const body = await readJsonBody(request);
  if (!isRecord(body) || !hasText(body.installationId) || !hasText(body.requestedLabel)) {
    writeJson(response, 400, { error: 'installationId and requestedLabel are required' });
    return;
  }
  if (request.headers['idempotency-key'] !== body.installationId) {
    writeJson(response, 400, { error: 'Idempotency-Key must match installationId' });
    return;
  }
  const requestedLabel = body.requestedLabel.toLowerCase();
  if (!/^[a-z0-9-]+$/.test(requestedLabel)) {
    writeJson(response, 400, { error: 'requestedLabel must be a DNS label' });
    return;
  }
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
      id: randomUUID(),
      installationId: body.installationId,
      requestedLabel,
      token: randomBytes(24).toString('base64url'),
      zone: `${requestedLabel}.${testZone}`,
      targets: [],
      challenges: [],
    };
    state.allocations.push(allocation);
    audit('allocation_reserved', { allocationId: allocation.id, zone: allocation.zone });
    await persistState();
  }
  writeJson(response, 201, {
    allocationId: allocation.id,
    scopedToken: allocation.token,
    zone: allocation.zone,
  });
}

function authorizeProofControl(request, response) {
  if (request.headers['x-proof-control'] !== proofControlToken) {
    writeJson(response, 401, { error: 'proof control authorization is required' });
    return false;
  }
  return true;
}

async function bindTargets(request, response, allocation) {
  const body = await readJsonBody(request);
  if (!isRecord(body) || !Array.isArray(body.targets) || body.targets.length === 0) {
    writeJson(response, 400, { error: 'targets must be a non-empty array' });
    return;
  }
  const targets = body.targets.map(validateTarget);
  await clearTargetBackend(allocation);
  allocation.targets = targets;
  await applyTargets(allocation);
  audit('targets_bound', { allocationId: allocation.id, targets });
  await persistState();
  writeJson(response, 200, { allocationId: allocation.id, targets });
}

async function updateChallenge(request, response, allocation) {
  const body = await readJsonBody(request);
  if (!isRecord(body) || !hasText(body.name) || !hasText(body.value)) {
    writeJson(response, 400, { error: 'name and value are required' });
    return;
  }
  const name = normalizeName(body.name);
  if (!name.startsWith('_acme-challenge.') || !name.endsWith(`.${allocation.zone}`)) {
    audit('challenge_scope_denied', { allocationId: allocation.id, name });
    await persistState();
    writeJson(response, 403, { error: 'challenge name is outside the allocation zone' });
    return;
  }
  const challenge = { name, value: body.value };
  if (request.method === 'POST') {
    if (!allocation.challenges.some((entry) => entry.name === name && entry.value === body.value)) {
      allocation.challenges.push(challenge);
    }
    await setTxt(challenge);
    audit('challenge_presented', { allocationId: allocation.id, name, value: body.value });
    await persistState();
    writeJson(response, 201, challenge);
    return;
  }
  allocation.challenges = allocation.challenges.filter((entry) => entry.name !== name || entry.value !== body.value);
  await clearTxt(challenge);
  audit('challenge_cleaned', { allocationId: allocation.id, name, value: body.value });
  await persistState();
  response.writeHead(204).end();
}

function authorize(request, response, allocation) {
  if (allocation === undefined) {
    writeJson(response, 404, { error: 'allocation not found' });
    return false;
  }
  const supplied = request.headers.authorization;
  if (supplied !== `Bearer ${allocation.token}`) {
    audit('authority_denied', {
      allocationId: allocation.id,
      reason: 'allocation_token_mismatch',
      suppliedBearer: hasText(supplied),
    });
    void persistState();
    writeJson(response, 403, { error: 'token is not authorized for this allocation' });
    return false;
  }
  return true;
}

function validateTarget(value) {
  if (!isRecord(value) || !['A', 'AAAA', 'hostname'].includes(value.type) || !hasText(value.value)) {
    throw new Error('Each target requires type A, AAAA, or hostname and a value.');
  }
  if (value.type === 'A' && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.value)) {
    throw new Error('Invalid proof A target.');
  }
  if (value.type === 'AAAA' && !value.value.includes(':')) {
    throw new Error('Invalid proof AAAA target.');
  }
  if (value.type === 'hostname' && /^[\d.:]+$/.test(value.value)) {
    throw new Error('Hostname target must remain a hostname.');
  }
  return { type: value.type, value: value.value };
}

async function replayDesiredState(reason) {
  for (const allocation of state.allocations) {
    await applyTargets(allocation);
    for (const challenge of allocation.challenges) {
      await setTxt(challenge);
    }
  }
  state.replayCount += 1;
  audit('desired_state_replayed', {
    reason,
    allocationCount: state.allocations.length,
    challengeCount: state.allocations.flatMap((entry) => entry.challenges).length,
    targetCount: state.allocations.flatMap((entry) => entry.targets).length,
  });
  await persistState();
}

async function clearBackendWithoutChangingDesiredState() {
  for (const allocation of state.allocations) {
    await clearTargetBackend(allocation);
    for (const challenge of allocation.challenges) {
      await clearTxt(challenge);
    }
  }
}

async function applyTargets(allocation) {
  const grouped = Object.groupBy(allocation.targets, (target) => target.type);
  if (grouped.A !== undefined) {
    await challengeRequest('/add-a', {
      host: `a.${allocation.zone}`,
      addresses: grouped.A.map((target) => target.value),
    });
  }
  if (grouped.AAAA !== undefined) {
    await challengeRequest('/add-aaaa', {
      host: `aaaa.${allocation.zone}`,
      addresses: grouped.AAAA.map((target) => target.value),
    });
  }
  if (grouped.hostname !== undefined) {
    await challengeRequest('/set-cname', {
      host: `hostname.${allocation.zone}`,
      target: normalizeName(grouped.hostname[0].value),
    });
  }
}

async function clearTargetBackend(allocation) {
  await challengeRequest('/clear-a', { host: `a.${allocation.zone}` });
  await challengeRequest('/clear-aaaa', { host: `aaaa.${allocation.zone}` });
  await challengeRequest('/clear-cname', { host: `hostname.${allocation.zone}` });
}

async function setTxt(challenge) {
  await challengeRequest('/set-txt', { host: `${challenge.name}.`, value: challenge.value });
}

async function clearTxt(challenge) {
  await challengeRequest('/clear-txt', { host: `${challenge.name}.`, value: challenge.value });
}

async function challengeRequest(path, body) {
  const endpoint = new URL(path, challengeServerUrl);
  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`challenge DNS backend ${path} returned ${response.status}`);
  }
}

async function readDnsHistory(host) {
  const endpoint = new URL('/dns-request-history', challengeServerUrl);
  const response = await fetch(endpoint, {
    body: JSON.stringify({ host }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`challenge DNS backend history returned ${response.status}`);
  }
  return await response.json();
}

async function loadState() {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'));
    return {
      allocations: Array.isArray(value.allocations) ? value.allocations : [],
      audit: Array.isArray(value.audit) ? value.audit : [],
      replayCount: Number.isInteger(value.replayCount) ? value.replayCount : 0,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    return { allocations: [], audit: [], replayCount: 0 };
  }
}

async function persistState() {
  const temporaryPath = `${statePath}.next`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporaryPath, statePath);
}

function publicState() {
  return {
    allocations: state.allocations.map((allocation) => {
      const observation = { ...allocation };
      delete observation.token;
      return observation;
    }),
    audit: state.audit,
    replayCount: state.replayCount,
  };
}

function audit(event, fields) {
  const entry = { at: new Date().toISOString(), event, ...fields };
  state.audit.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function findAllocation(id) {
  return state.allocations.find((allocation) => allocation.id === id);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new Error('request body exceeds 64 KiB');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function normalizeName(value) {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!hasText(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
