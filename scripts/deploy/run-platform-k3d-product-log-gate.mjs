import { setTimeout as delay } from 'node:timers/promises';

import { captureCommand, runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const platformNamespace = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment';
const platformName = 'compartment';
const observabilityNamespace = `${platformName}-observability`;
const agentName = `${platformName}-log-agent`;
const retainedLinesPerApp = 1_000;
const configuredBufferMaxBytes = 268_435_488;
// Ingest is never refused now, so the agent drains continuously and must stay well under its runaway guard.
const bufferMaxBytes = 150_994_944;
const windowHoldAttempts = 10;
const loadPodCount = 7;
const loadPodImage = 'public.ecr.aws/docker/library/node:24.15.0-bookworm';
const kubernetesReadinessTimeout = '4m';
const productDeploymentHealthAttempts = 6;
const productDeploymentHealthIntervalMs = 5_000;
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const loadProgram = `
const line = "p7-bounded-buffer-" + "x".repeat(3400);
let index = 0;
(async () => {
  while (index < 6000) {
    for (let count = 0; count < 250 && index < 6000; count += 1) {
      if (!process.stdout.write(line + "-" + index++ + "\\n")) {
        await new Promise((resolve) => process.stdout.once("drain", resolve));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  setInterval(() => {}, 60000);
})();
`;

export function parseNonNegativeInteger(output, label) {
  const value = output.trim();
  if (!/^\d+$/u.test(value)) {
    throw new Error(`Unable to read ${label}.`);
  }
  return Number.parseInt(value, 10);
}

export function parseProductLogBufferBytes(metrics) {
  return parseProductLogBufferMetric(metrics, 'vector_buffer_byte_size', 'product-log buffer size');
}

export function parseProductLogBufferMaxBytes(metrics) {
  return parseProductLogBufferMetric(metrics, 'vector_buffer_max_byte_size', 'product-log buffer maximum');
}

function parseProductLogBufferMetric(metrics, metricName, label) {
  const line = metrics
    .split('\n')
    .find((candidate) => candidate.startsWith(`${metricName}{`) && candidate.includes('component_id="product_store"'));
  const value = line?.match(/\}\s+(\d+)(?:\s|$)/u)?.[1];
  if (value === undefined) {
    throw new Error(`Unable to read ${label}.`);
  }
  return parseNonNegativeInteger(value, label);
}

export function findDegradedProductDeployments(rawDeployments) {
  return JSON.parse(rawDeployments).items.filter((deployment) => {
    const desiredReplicas = deployment.spec.replicas ?? 1;
    const availableReplicas = deployment.status.availableReplicas ?? 0;
    return deployment.metadata.namespace.startsWith('cpt-') && availableReplicas < desiredReplicas;
  });
}

export function createLoadPodOverrides(containerName) {
  return {
    spec: {
      containers: [
        {
          command: ['node', '-e', loadProgram],
          image: loadPodImage,
          name: containerName,
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'] },
            privileged: false,
          },
        },
      ],
      securityContext: {
        runAsGroup: 10_001,
        runAsNonRoot: true,
        runAsUser: 10_001,
        seccompProfile: { type: 'RuntimeDefault' },
      },
    },
  };
}

async function runPlatformK3dProductLogGate() {
  let loadTarget;
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
        `--timeout=${kubernetesReadinessTimeout}`,
      ],
      repositoryRoot,
    );
    loadTarget = await startLoadPods();
    const bufferBytes = await waitForBoundedRetainedWindow();
    await assertPlatformHealthy(loadTarget);
    process.stdout.write(
      `product_log_gate retained_lines=${retainedLinesPerApp} buffer_bytes=${bufferBytes} buffer_max_bytes=${configuredBufferMaxBytes} status=ok\n`,
    );
  } finally {
    cleanup(loadTarget);
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

function readWidestRetainedWindow() {
  return parseNonNegativeInteger(
    psql(
      `select coalesce(max(line_count), 0) from
         (select count(*) as line_count from deployment_product_logs group by app_key) as windows;`,
    ),
    'widest retained product-log window',
  );
}

async function startLoadPods() {
  const sourcePod = JSON.parse(
    captureCommand(
      'kubectl',
      [
        '--context',
        context,
        'get',
        'pods',
        '--all-namespaces',
        '--field-selector=status.phase=Running',
        '--output=json',
      ],
      repositoryRoot,
    ),
  ).items.find(
    (pod) =>
      pod.metadata.namespace.startsWith('cpt-prj-') &&
      pod.status.containerStatuses?.some((container) => container.ready && container.name.startsWith('app-')),
  );
  const namespace = sourcePod?.metadata.namespace;
  const containerName = sourcePod?.status.containerStatuses?.find(
    (container) => container.ready && container.name.startsWith('app-'),
  )?.name;
  if (namespace === undefined || containerName === undefined) {
    throw new Error('No ready product deployment is available for the product-log buffer gate.');
  }
  const podNames = Array.from({ length: loadPodCount }, (_, index) => `p7-buffer-load-${index}`);
  const overrides = JSON.stringify(createLoadPodOverrides(containerName));
  for (const podName of podNames) {
    runCommand(
      'kubectl',
      [
        '--context',
        context,
        '--namespace',
        namespace,
        'run',
        podName,
        `--image=${loadPodImage}`,
        '--restart=Never',
        `--overrides=${overrides}`,
      ],
      repositoryRoot,
    );
    runCommand(
      'kubectl',
      [
        '--context',
        context,
        '--namespace',
        namespace,
        'wait',
        `pod/${podName}`,
        '--for=condition=Ready',
        `--timeout=${kubernetesReadinessTimeout}`,
      ],
      repositoryRoot,
    );
    await delay(10_000);
  }
  return { namespace, podNames };
}

/**
 * The load pods share one product deployment's container identity, so every line they emit lands in a
 * single app window. That window must fill to the retained line count and then stop growing, while the
 * agent keeps draining instead of accumulating an unbounded disk buffer.
 */
async function waitForBoundedRetainedWindow() {
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
  let widestWindow = 0;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    widestWindow = readWidestRetainedWindow();
    if (widestWindow >= retainedLinesPerApp) {
      break;
    }
    await delay(1_000);
  }
  if (widestWindow !== retainedLinesPerApp) {
    throw new Error(`Product-log window did not reach the retained line count: lines=${widestWindow}.`);
  }
  let bufferBytes = readProductLogBufferBytes(agentPod);
  for (let attempt = 0; attempt < windowHoldAttempts; attempt += 1) {
    await delay(1_000);
    widestWindow = readWidestRetainedWindow();
    bufferBytes = readProductLogBufferBytes(agentPod);
    if (widestWindow > retainedLinesPerApp) {
      throw new Error(`Product-log window grew past the retained line count: lines=${widestWindow}.`);
    }
    if (bufferBytes > bufferMaxBytes) {
      throw new Error(`Product-log buffer grew past its runaway guard: bytes=${bufferBytes}.`);
    }
  }
  return bufferBytes;
}

function readProductLogBufferBytes(agentPod) {
  const metrics = captureCommand(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      observabilityNamespace,
      'exec',
      agentPod,
      '--',
      'wget',
      '--quiet',
      '--output-document=-',
      'http://127.0.0.1:9598/metrics',
    ],
    repositoryRoot,
  );
  const configuredMaxBytes = parseProductLogBufferMaxBytes(metrics);
  if (configuredMaxBytes !== configuredBufferMaxBytes) {
    throw new Error(`Unexpected product-log buffer maximum: bytes=${configuredMaxBytes}.`);
  }
  return parseProductLogBufferBytes(metrics);
}

async function assertPlatformHealthy(loadTarget) {
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
  for (const podName of loadTarget.podNames) {
    const ready = captureCommand(
      'kubectl',
      [
        '--context',
        context,
        '--namespace',
        loadTarget.namespace,
        'get',
        'pod',
        podName,
        '--output',
        'jsonpath={.status.containerStatuses[0].ready}',
      ],
      repositoryRoot,
    );
    if (ready !== 'true') {
      throw new Error(`Product-log load pod ${podName} is not Ready.`);
    }
  }
  let degradedDeployments = [];
  for (let attempt = 1; attempt <= productDeploymentHealthAttempts; attempt += 1) {
    const deployments = captureCommand(
      'kubectl',
      ['--context', context, 'get', 'deployments', '--all-namespaces', '--output=json'],
      repositoryRoot,
    );
    degradedDeployments = findDegradedProductDeployments(deployments);
    if (degradedDeployments.length === 0) {
      return;
    }
    if (attempt < productDeploymentHealthAttempts) {
      await delay(productDeploymentHealthIntervalMs);
    }
  }
  if (degradedDeployments.length > 0) {
    const references = degradedDeployments
      .map((deployment) => `${deployment.metadata.namespace}/${deployment.metadata.name}`)
      .join(', ');
    throw new Error(`Product deployments remained unavailable during the product-log buffer gate: ${references}.`);
  }
}

function cleanup(loadTarget) {
  if (loadTarget !== undefined) {
    try {
      runCommand(
        'kubectl',
        [
          '--context',
          context,
          '--namespace',
          loadTarget.namespace,
          'delete',
          'pod',
          ...loadTarget.podNames,
          '--ignore-not-found',
        ],
        repositoryRoot,
      );
    } catch {
      // Cleanup remains best-effort so the original gate failure is preserved.
    }
  }
}

runMain(import.meta.url, process.argv[1], runPlatformK3dProductLogGate);
