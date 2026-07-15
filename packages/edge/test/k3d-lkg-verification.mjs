import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const apiDeployment = splitWorkloadIdentity(requiredValue('COMPARTMENT_P10_API_DEPLOYMENT'));
const edgeDeployment = splitWorkloadIdentity(requiredValue('COMPARTMENT_P10_EDGE_DEPLOYMENT'));
const upstreamProbeCommand = requiredValue('COMPARTMENT_P10_UPSTREAM_PROBE_COMMAND');
const reloginProbeCommand = requiredValue('COMPARTMENT_P10_RELOGIN_PROBE_COMMAND');
const postRestoreCommand = requiredValue('COMPARTMENT_P10_POST_RESTORE_COMMAND');
const authorizedProbeCommand = requiredValue('COMPARTMENT_P10_AUTHORIZED_PROBE_COMMAND');
const revokeCommand = requiredValue('COMPARTMENT_P10_REVOKE_COMMAND');
const grantCommand = requiredValue('COMPARTMENT_P10_GRANT_COMMAND');
const kubeContext = process.env.COMPARTMENT_P10_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const snapshotPath = process.env.COMPARTMENT_P10_SNAPSHOT_PATH ?? '/var/lib/compartment/snapshots/access-state.json';
const snapshotHost = requiredValue('COMPARTMENT_P10_SNAPSHOT_HOST');
const revocationSamples = readPositiveInteger('COMPARTMENT_P10_REVOCATION_SAMPLES', 100);
const kubectlContextArgs = ['--context', kubeContext];
const apiReplicas = kubectl([
  '-n',
  apiDeployment.namespace,
  'get',
  'deployment',
  apiDeployment.name,
  '-o',
  'jsonpath={.spec.replicas}',
]).trim();

try {
  runCommand(upstreamProbeCommand);
  const edgePod = kubectl([
    '-n',
    edgeDeployment.namespace,
    'get',
    'pod',
    '-l',
    'app.kubernetes.io/component=edge',
    '-o',
    'jsonpath={.items[0].metadata.name}',
  ]).trim();
  kubectl(['-n', edgeDeployment.namespace, 'exec', edgePod, '--', 'test', '-s', snapshotPath], 'inherit');
  await waitUntil(
    () =>
      kubectlSucceeds([
        '-n',
        edgeDeployment.namespace,
        'exec',
        edgePod,
        '--',
        'grep',
        '--fixed-strings',
        '--quiet',
        `"host":"${snapshotHost}"`,
        snapshotPath,
      ]),
    30_000,
    200,
    'current route did not converge into the edge snapshot within 30s',
  );

  scaleDeployment(apiDeployment, '0');
  kubectl(['-n', edgeDeployment.namespace, 'rollout', 'restart', 'deployment', edgeDeployment.name], 'inherit');
  kubectl(
    ['-n', edgeDeployment.namespace, 'rollout', 'status', 'deployment', edgeDeployment.name, '--timeout=120s'],
    'inherit',
  );
  runCommand(reloginProbeCommand);

  scaleDeployment(apiDeployment, apiReplicas);
  kubectl(
    ['-n', apiDeployment.namespace, 'rollout', 'status', 'deployment', apiDeployment.name, '--timeout=120s'],
    'inherit',
  );
  runCommand(postRestoreCommand);

  const samples = [];
  for (let sample = 0; sample < revocationSamples; sample += 1) {
    runCommand(grantCommand);
    await waitUntil(() => commandSucceeds(authorizedProbeCommand), 30_000, 100, 'grant did not converge within 30s');
    const startedAt = Date.now();
    runCommand(revokeCommand);
    await waitUntil(
      () => !commandSucceeds(authorizedProbeCommand),
      30_000,
      50,
      'revocation did not converge within 30s',
    );
    samples.push(Date.now() - startedAt);
  }

  samples.sort((left, right) => left - right);
  process.stdout.write(
    `revocation_ms p95=${percentile(samples, 95)} p99=${percentile(samples, 99)} samples=${revocationSamples}\n`,
  );
} finally {
  scaleDeployment(apiDeployment, apiReplicas);
}

function requiredValue(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readPositiveInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function splitWorkloadIdentity(value) {
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid namespace/deployment identity: ${value}`);
  }
  return { name: value.slice(separator + 1), namespace: value.slice(0, separator) };
}

function kubectl(args, stdio = 'pipe') {
  return execFileSync('kubectl', [...kubectlContextArgs, ...args], { encoding: 'utf8', stdio });
}

function kubectlSucceeds(args) {
  return spawnSync('kubectl', [...kubectlContextArgs, ...args], { stdio: 'ignore' }).status === 0;
}

function scaleDeployment(deployment, replicas) {
  kubectl(['-n', deployment.namespace, 'scale', 'deployment', deployment.name, `--replicas=${replicas}`], 'ignore');
}

function runCommand(command) {
  execFileSync(command, [], { stdio: 'inherit' });
}

function commandSucceeds(command) {
  return spawnSync(command, [], { stdio: 'ignore' }).status === 0;
}

async function waitUntil(predicate, timeoutMs, intervalMs, failureMessage) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(failureMessage);
    }
    await delay(intervalMs);
  }
}

function percentile(sortedValues, percentage) {
  return sortedValues[Math.ceil((sortedValues.length * percentage) / 100) - 1];
}
