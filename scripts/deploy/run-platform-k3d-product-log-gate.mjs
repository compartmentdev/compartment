import { setTimeout as delay } from 'node:timers/promises';

import { captureCommand, runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const context = 'k3d-compartment-e2e';
const platformNamespace = 'compartment';
const loadNamespace = 'cpt-p7-buffer-gate';
const platformName = 'compartment-compartment';
const observabilityNamespace = `${platformName}-observability`;
const agentName = `${platformName}-log-agent`;
const quotaMaxBytes = 1_073_741_824;
const bufferMinBytes = 209_715_200;
const bufferMaxBytes = 285_212_672;
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const loadProgram = `
const line = "p7-bounded-buffer-" + "x".repeat(4000);
let index = 0;
const writeBatch = () => {
  if (index >= 75000) {
    setInterval(() => {}, 60000);
    return;
  }
  for (let count = 0; count < 1000; count += 1) {
    if (!process.stdout.write(line + "-" + index++ + "\\n")) {
      process.stdout.once("drain", writeBatch);
      return;
    }
  }
  setImmediate(writeBatch);
};
writeBatch();
`;

export function parseNonNegativeInteger(output, label) {
  const value = output.trim();
  if (!/^\d+$/u.test(value)) {
    throw new Error(`Unable to read ${label}.`);
  }
  return Number.parseInt(value, 10);
}

export function findDegradedProductDeployments(rawDeployments) {
  return JSON.parse(rawDeployments).items.filter(
    (deployment) =>
      deployment.metadata.namespace.startsWith('cpt-') &&
      deployment.status.availableReplicas !== deployment.spec.replicas,
  );
}

export async function runPlatformK3dProductLogGate() {
  let originalQuota;
  try {
    runCommand(
      'kubectl',
      [
        '--context',
        context,
        '--namespace',
        observabilityNamespace,
        'rollout',
        'status',
        `daemonset/${agentName}`,
        '--timeout=3m',
      ],
      repositoryRoot,
    );
    originalQuota = readQuota();
    writeQuota(quotaMaxBytes);
    startLoadPod();
    const bufferBytes = await waitForBoundedBuffer();
    assertPlatformHealthy();
    const currentQuota = readQuota();
    if (currentQuota !== quotaMaxBytes) {
      throw new Error(`Product-log quota changed while ingest was backpressured: ${currentQuota}.`);
    }
    process.stdout.write(`product_log_gate buffer_bytes=${bufferBytes} quota_bytes=${currentQuota} status=ok\n`);
  } finally {
    cleanup(originalQuota);
  }
}

function psql(statement) {
  return captureCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      platformNamespace,
      'exec',
      `deployment/${platformName}-postgres`,
      '--',
      'psql',
      '--username',
      'postgres',
      '--dbname',
      'compartment',
      '--tuples-only',
      '--no-align',
      '--command',
      statement,
    ],
    repositoryRoot,
  );
}

function readQuota() {
  return parseNonNegativeInteger(
    psql("select used_bytes from product_log_store_quota where id = 'global';"),
    'product-log quota',
  );
}

function writeQuota(value) {
  psql(`update product_log_store_quota set used_bytes = ${value} where id = 'global';`);
}

function startLoadPod() {
  runCommand('kubectl', ['--context', context, 'create', 'namespace', loadNamespace], repositoryRoot);
  runCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      loadNamespace,
      'run',
      'app-buffer-load',
      '--image=public.ecr.aws/docker/library/node:24.15.0-bookworm',
      '--restart=Never',
      '--command',
      '--',
      'node',
      '-e',
      loadProgram,
    ],
    repositoryRoot,
  );
  runCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      loadNamespace,
      'wait',
      'pod/app-buffer-load',
      '--for=condition=Ready',
      '--timeout=3m',
    ],
    repositoryRoot,
  );
}

async function waitForBoundedBuffer() {
  const agentPod = captureCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      observabilityNamespace,
      'get',
      'pod',
      '--selector',
      `app.kubernetes.io/name=${agentName}`,
      '--output',
      'jsonpath={.items[0].metadata.name}',
    ],
    repositoryRoot,
  );
  const agentNode = captureCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      observabilityNamespace,
      'get',
      'pod',
      agentPod,
      '--output',
      'jsonpath={.spec.nodeName}',
    ],
    repositoryRoot,
  );
  let bufferBytes = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const output = captureCommand(
      'docker',
      ['exec', agentNode, 'du', '-sb', `/var/lib/compartment/${agentName}`],
      repositoryRoot,
    );
    bufferBytes = parseNonNegativeInteger(output.split(/\s+/u)[0] ?? '', 'product-log buffer size');
    if (bufferBytes >= bufferMinBytes) {
      break;
    }
    await delay(1_000);
  }
  if (bufferBytes < bufferMinBytes || bufferBytes > bufferMaxBytes) {
    throw new Error(`Product-log buffer did not backpressure within bounds: bytes=${bufferBytes}.`);
  }
  return bufferBytes;
}

function assertPlatformHealthy() {
  runCommand('kubectl', ['--context', context, '--request-timeout=5s', 'get', '--raw=/readyz'], repositoryRoot);
  runCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      platformNamespace,
      'rollout',
      'status',
      `deployment/${platformName}-api`,
      '--timeout=30s',
    ],
    repositoryRoot,
  );
  const ready = captureCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      loadNamespace,
      'get',
      'pod',
      'app-buffer-load',
      '--output',
      'jsonpath={.status.containerStatuses[0].ready}',
    ],
    repositoryRoot,
  );
  if (ready !== 'true') {
    throw new Error('Product-log load pod is not Ready.');
  }
  const deployments = captureCommand(
    'kubectl',
    ['--context', context, 'get', 'deployments', '--all-namespaces', '--output', 'json'],
    repositoryRoot,
  );
  if (findDegradedProductDeployments(deployments).length > 0) {
    throw new Error('A product deployment became unavailable during the product-log buffer gate.');
  }
}

function cleanup(originalQuota) {
  if (originalQuota !== undefined) {
    try {
      writeQuota(originalQuota);
    } catch {
      // Cleanup remains best-effort so the original gate failure is preserved.
    }
  }
  try {
    runCommand(
      'kubectl',
      ['--context', context, 'delete', 'namespace', loadNamespace, '--ignore-not-found', '--wait=false'],
      repositoryRoot,
    );
  } catch {
    // Cleanup remains best-effort so the original gate failure is preserved.
  }
}

runMain(import.meta.url, process.argv[1], runPlatformK3dProductLogGate);
