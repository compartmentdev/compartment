import { captureCommand, runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const shard = process.env.COMPARTMENT_E2E_SHARD ?? 'default';
const namespace = `retained-state-${shard}`;
const buildNamespace = `${namespace}-build`;
const release = 'restore2-state';
const projectProvisioningNamespace = `${release}-compartment-project-provisioning`;
const secretName = `${release}-install-state`;
const registryAuthServiceName = `${release}-compartment-registry-auth`;
const previousRegistryAddressServiceName = `${release}-previous-registry-address`;
function registryHelmArgs(clusterIp) {
  return ['--set', `registry.hostname=${clusterIp}`, '--set', 'registry.issuerRef.name=retained-registry-issuer'];
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
      ...registryHelmArgs(registryClusterIp),
    ]);
    helm(['uninstall', release, '--namespace', namespace]);
    kubectl(['wait', '--for=delete', `namespace/${buildNamespace}`, '--timeout=60s']);
    kubectl(['wait', '--for=delete', `namespace/${projectProvisioningNamespace}`, '--timeout=60s']);
    kubectl(['--namespace', namespace, 'get', 'secret', secretName]);
    kubectl(['--namespace', namespace, 'get', 'service', registryAuthServiceName]);
    kubectl(['--namespace', namespace, 'delete', 'service', registryAuthServiceName]);
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
      ...registryHelmArgs(reinstalledRegistryClusterIp),
    ]);
    const installationId = readSecretValue('installation-id');
    const acmeDnsToken = readSecretValue('managed-domain-acme-dns-token');
    const brokerUrl = readSecretValue('managed-domain-broker-url');
    const registryHostname = readSecretValue('registry-hostname');
    const registryIssuerName = readSecretValue('registry-issuer-ref-name');
    kubectl(['--namespace', namespace, 'get', 'deployment', `${release}-compartment-registry-auth`]);
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
      acmeDnsToken !== 'retained-token' ||
      brokerUrl !== 'https://broker.example.test' ||
      registryHostname !== reinstalledRegistryClusterIp ||
      registryIssuerName !== 'retained-registry-issuer' ||
      runtimeBrokerUrl !== 'https://broker.example.test' ||
      reinstalledRegistryClusterIp === registryClusterIp
    ) {
      throw new Error('Retained install state did not rotate to the replacement registry Service address.');
    }
  } finally {
    cleanup();
  }
}

function readServiceClusterIp() {
  return captureKubectl([
    '--namespace',
    namespace,
    'get',
    'service',
    registryAuthServiceName,
    '--output',
    'jsonpath={.spec.clusterIP}',
  ]);
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
