import { captureCommand, runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const shard = process.env.COMPARTMENT_E2E_SHARD ?? 'default';
const namespace = `retained-state-${shard}`;
const release = 'restore2-state';
const secretName = `${release}-install-state`;

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

function runRetainedInstallStateGate() {
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
      '--set',
      'platform.tlsMode=managed',
      '--set',
      'platform.managedDomainBrokerUrl=https://broker.example.test',
      '--set',
      'secrets.managedDomainBrokerToken=retained-token',
    ]);
    helm(['uninstall', release, '--namespace', namespace]);
    kubectl(['--namespace', namespace, 'get', 'secret', secretName]);
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
      'platform.installationId=replacement-attempt',
    ]);
    const installationId = readSecretValue('installation-id');
    const brokerUrl = readSecretValue('managed-domain-broker-url');
    const runtimeBrokerUrl = captureKubectl([
      '--namespace',
      namespace,
      'get',
      'configmap',
      `${release}-compartment`,
      '--output',
      'jsonpath={.data.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL}',
    ]);
    if (
      installationId !== 'retained-installation' ||
      brokerUrl !== 'https://broker.example.test' ||
      runtimeBrokerUrl !== 'https://broker.example.test'
    ) {
      throw new Error('Retained install-state values changed during the replacement install attempt.');
    }
  } finally {
    cleanup();
  }
}

function readSecretValue(key) {
  const encodedValue = captureKubectl([
    '--namespace',
    namespace,
    'get',
    'secret',
    secretName,
    '--output',
    `jsonpath={.data.${key}}`,
  ]);
  return Buffer.from(encodedValue, 'base64').toString('utf8');
}

runMain(import.meta.url, process.argv[1], runRetainedInstallStateGate);
