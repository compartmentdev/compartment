import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import { captureCommand, runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const shard = process.env.COMPARTMENT_E2E_SHARD ?? 'default';
const namespace = `retained-state-${shard}`;
const buildNamespace = `${namespace}-build`;
const release = 'restore2-state';
const platformName = `${release}-compartment`;
const projectProvisioningNamespace = `${platformName}-project-provisioning`;
const secretName = `${release}-install-state`;
const registryAuthName = `${platformName}-registry-auth`;
const previousRegistryAddressServiceName = `${release}-previous-registry-address`;
const deploymentConvergenceAttempts = 180;
const deploymentConvergenceDelayMs = 1_000;
const platformValuesPath =
  process.env.COMPARTMENT_E2E_PLATFORM_VALUES_PATH ?? '.compartment/platform-k3d-e2e-values.yaml';
function registryHelmArgs(clusterIp) {
  return ['--set', `registry.hostname=${clusterIp}`, '--set', 'registry.issuerRef.name=retained-registry-issuer'];
}

function buildkitSeedHelmArgs() {
  return createBuildkitSeedHelmArgs(parse(readFileSync(platformValuesPath, 'utf8')));
}

export function createBuildkitSeedHelmArgs(values) {
  const seed = values?.images?.buildkitSeed;
  const cache = values?.buildkitSeedCache;
  if (
    typeof seed?.repository !== 'string' ||
    typeof seed.tag !== 'string' ||
    typeof seed.digest !== 'string' ||
    typeof cache?.sourceRegistryScheme !== 'string' ||
    typeof cache.sourceRegistryUrl !== 'string'
  ) {
    throw new Error('Expected BuildKit seed image and cache source values from the platform k3d topology.');
  }
  return [
    '--set-string',
    `images.buildkitSeed.repository=${seed.repository}`,
    '--set-string',
    `images.buildkitSeed.tag=${seed.tag}`,
    '--set-string',
    `images.buildkitSeed.digest=${seed.digest}`,
    '--set-string',
    `buildkitSeedCache.sourceRegistryScheme=${cache.sourceRegistryScheme}`,
    '--set-string',
    `buildkitSeedCache.sourceRegistryUrl=${cache.sourceRegistryUrl}`,
  ];
}

function dataNodePoolHelmArgs() {
  return ['--set-string', 'nodePools.data.nodeSelector.compartment\\.dev/node-pool=data'];
}

function helm(args) {
  runCommand('helm', [...args, '--kube-context', context], repositoryRoot);
}

function kubectl(args) {
  runCommand('kubectl', ['--context', context, ...args], repositoryRoot);
}

function captureKubectl(args) {
  return captureCommand('kubectl', ['--context', context, ...args], repositoryRoot);
}

function cleanup() {
  try {
    helm(['uninstall', release, '--namespace', namespace]);
  } catch {
    // Preserve the gate result when best-effort cleanup finds no release.
  }
  try {
    kubectl(['delete', 'namespace', namespace, '--ignore-not-found', '--wait=false']);
  } catch {
    // Preserve the gate result when best-effort cleanup cannot reach the namespace.
  }
}

async function runRetainedInstallStateGate() {
  cleanup();
  try {
    helm([
      'upgrade',
      '--install',
      release,
      './deploy/chart/compartment',
      '--namespace',
      namespace,
      '--create-namespace',
      '--set',
      'platform.startupStage=foundation',
      '--set',
      'platform.installationId=retained-installation',
      '--set',
      'platform.domainMode=managed',
      '--set',
      'platform.baseDomain=retained.example.test',
      '--set',
      'platform.publicProtocol=https',
      '--set-literal',
      'ingress.targetsJson=[{"type":"A","value":"8.8.8.8"}]',
      '--set',
      'platform.acmeEmail=retained@example.test',
      '--set',
      'platform.tlsMode=broker-dns01',
      '--set',
      'platform.managedDomainBrokerUrl=https://broker.example.test',
      '--set',
      'secrets.managedDomainAcmeDnsToken=retained-token',
    ]);
    const registryClusterIp = readServiceClusterIp();
    helm([
      'upgrade',
      release,
      './deploy/chart/compartment',
      '--namespace',
      namespace,
      '--set',
      'platform.startupStage=full',
      '--set',
      `buildkit.namespace=${buildNamespace}`,
      '--set',
      'productLogs.enabled=false',
      '--set',
      'api.replicas=1',
      '--set',
      'edge.replicas=1',
      '--set',
      'edge.snapshots.enabled=true',
      ...buildkitSeedHelmArgs(),
      ...dataNodePoolHelmArgs(),
      ...registryHelmArgs(registryClusterIp),
    ]);
    const postgresPodName = await waitForDeploymentPod(`${platformName}-postgres`, 'postgres');
    writePostgresSentinel(postgresPodName);
    const postgresPvcUid = readPvcUid('postgres');
    const apiPvcUid = readPvcUid('api');
    const edgeSnapshotsPvcUid = readPvcUid('edge-snapshots');
    const postgresPassword = readSecretValue(platformName, 'postgres-password');
    const tenantSecretsKek = readSecretValue(platformName, 'tenant-secrets-kek');
    helm(['uninstall', release, '--namespace', namespace]);
    kubectl(['wait', '--for=delete', `namespace/${buildNamespace}`, '--timeout=60s']);
    kubectl(['wait', '--for=delete', `namespace/${projectProvisioningNamespace}`, '--timeout=60s']);
    kubectl(['--namespace', namespace, 'get', 'secret', secretName]);
    kubectl(['--namespace', namespace, 'get', 'service', registryAuthName]);
    kubectl(['--namespace', namespace, 'delete', 'service', registryAuthName]);
    kubectl([
      '--namespace',
      namespace,
      'create',
      'service',
      'clusterip',
      previousRegistryAddressServiceName,
      `--clusterip=${registryClusterIp}`,
      '--tcp=443:443',
    ]);
    helm([
      'upgrade',
      '--install',
      release,
      './deploy/chart/compartment',
      '--namespace',
      namespace,
      '--set',
      'platform.startupStage=foundation',
      '--set',
      `buildkit.namespace=${buildNamespace}`,
      '--set',
      'productLogs.enabled=false',
      ...buildkitSeedHelmArgs(),
      ...dataNodePoolHelmArgs(),
      ...registryHelmArgs(registryClusterIp),
    ]);
    const reinstalledRegistryClusterIp = readServiceClusterIp();
    helm([
      'upgrade',
      '--install',
      release,
      './deploy/chart/compartment',
      '--namespace',
      namespace,
      '--set',
      'platform.startupStage=full',
      '--set',
      'platform.installationId=replacement-attempt',
      '--set',
      'secrets.registryCredentialSigningKey=reinstalled-registry-signing-key-with-at-least-32-characters',
      '--set',
      'secrets.productLogIngestToken=reinstalled-product-log-token',
      '--set',
      `buildkit.namespace=${buildNamespace}`,
      '--set',
      'productLogs.enabled=false',
      '--set',
      'api.replicas=1',
      '--set',
      'edge.replicas=1',
      '--set',
      'edge.snapshots.enabled=true',
      ...buildkitSeedHelmArgs(),
      ...dataNodePoolHelmArgs(),
      ...registryHelmArgs(reinstalledRegistryClusterIp),
    ]);
    const installationId = readSecretValue(secretName, 'installation-id');
    const acmeDnsToken = readSecretValue(secretName, 'managed-domain-acme-dns-token');
    const brokerUrl = readSecretValue(secretName, 'managed-domain-broker-url');
    const registryHostname = readSecretValue(secretName, 'registry-hostname');
    const registryIssuerName = readSecretValue(secretName, 'registry-issuer-ref-name');
    const reinstalledPostgresPodName = await waitForDeploymentPod(`${platformName}-postgres`, 'postgres');
    const retainedSentinel = readPostgresSentinel(reinstalledPostgresPodName);
    kubectl(['--namespace', namespace, 'get', 'deployment', registryAuthName]);
    const runtimeBrokerUrl = captureKubectl([
      '--namespace',
      namespace,
      'get',
      'configmap',
      platformName,
      '--output',
      'jsonpath={.data.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL}',
    ]);
    if (
      installationId !== 'retained-installation' ||
      acmeDnsToken !== 'retained-token' ||
      brokerUrl !== 'https://broker.example.test' ||
      registryHostname !== reinstalledRegistryClusterIp ||
      registryIssuerName !== 'retained-registry-issuer' ||
      runtimeBrokerUrl !== 'https://broker.example.test' ||
      retainedSentinel !== 'retained-state-sentinel' ||
      readPvcUid('postgres') !== postgresPvcUid ||
      readPvcUid('api') !== apiPvcUid ||
      readPvcUid('edge-snapshots') !== edgeSnapshotsPvcUid ||
      readSecretValue(platformName, 'postgres-password') !== postgresPassword ||
      readSecretValue(platformName, 'tenant-secrets-kek') !== tenantSecretsKek ||
      reinstalledRegistryClusterIp === registryClusterIp
    ) {
      throw new Error('Retained install state did not rotate to the replacement registry Service address.');
    }
  } finally {
    cleanup();
  }
}

function writePostgresSentinel(podName) {
  kubectl([
    '--namespace',
    namespace,
    'exec',
    `pod/${podName}`,
    '--',
    'psql',
    '-U',
    'postgres',
    '-d',
    'compartment',
    '-c',
    "CREATE TABLE IF NOT EXISTS lifecycle_retention_gate (value text NOT NULL); TRUNCATE lifecycle_retention_gate; INSERT INTO lifecycle_retention_gate VALUES ('retained-state-sentinel');",
  ]);
}

function readPostgresSentinel(podName) {
  return captureKubectl([
    '--namespace',
    namespace,
    'exec',
    `pod/${podName}`,
    '--',
    'psql',
    '-U',
    'postgres',
    '-d',
    'compartment',
    '-Atc',
    'SELECT value FROM lifecycle_retention_gate LIMIT 1;',
  ]);
}

async function waitForDeploymentPod(deploymentName, component) {
  let lastDeployment = '';
  for (let attempt = 1; attempt <= deploymentConvergenceAttempts; attempt += 1) {
    lastDeployment = captureKubectl([
      '--namespace',
      namespace,
      'get',
      'deployment',
      deploymentName,
      '--output',
      'json',
    ]);
    if (isDeploymentConverged(lastDeployment)) {
      const podName = findReadyNonTerminatingPodName(
        captureKubectl([
          '--namespace',
          namespace,
          'get',
          'pods',
          '--selector',
          `app.kubernetes.io/instance=${release},app.kubernetes.io/component=${component}`,
          '--output',
          'json',
        ]),
      );
      if (podName !== undefined) {
        return podName;
      }
    }
    await delay(deploymentConvergenceDelayMs);
  }
  throw new Error(`Deployment ${deploymentName} did not converge on a Ready pod. Last state: ${lastDeployment}`);
}

export function isDeploymentConverged(output) {
  const deployment = JSON.parse(output);
  const desiredReplicas = deployment.spec?.replicas ?? 1;
  return (
    deployment.status?.observedGeneration === deployment.metadata?.generation &&
    deployment.status?.replicas === desiredReplicas &&
    deployment.status?.updatedReplicas === desiredReplicas &&
    deployment.status?.readyReplicas === desiredReplicas &&
    deployment.status?.availableReplicas === desiredReplicas &&
    (deployment.status?.unavailableReplicas ?? 0) === 0
  );
}

export function findReadyNonTerminatingPodName(output) {
  const pods = JSON.parse(output).items.filter(
    (pod) =>
      pod.metadata?.deletionTimestamp === undefined &&
      pod.status?.phase === 'Running' &&
      pod.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'),
  );
  return pods.length === 1 ? pods[0].metadata?.name : undefined;
}

function readPvcUid(suffix) {
  return captureKubectl([
    '--namespace',
    namespace,
    'get',
    'persistentvolumeclaim',
    `${platformName}-${suffix}`,
    '--output',
    'jsonpath={.metadata.uid}',
  ]);
}

function readServiceClusterIp() {
  return captureKubectl([
    '--namespace',
    namespace,
    'get',
    'service',
    registryAuthName,
    '--output',
    'jsonpath={.spec.clusterIP}',
  ]);
}

function readSecretValue(name, key) {
  const encodedValue = captureKubectl([
    '--namespace',
    namespace,
    'get',
    'secret',
    name,
    '--output',
    `jsonpath={.data.${key}}`,
  ]);
  return Buffer.from(encodedValue, 'base64').toString('utf8');
}

runMain(import.meta.url, process.argv[1], runRetainedInstallStateGate);
