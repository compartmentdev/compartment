import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import type { ManagedVmDownloadedArtifacts } from './managed-vm-artifacts.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { ensureManagedVmDirectory, installNewManagedVmFile } from './managed-vm-owned-file.service';
import { readManagedVmPathIdentity } from './managed-vm-state.service';
import { managedVmK3sGeneratedOwnedPaths } from './managed-vm-install-paths.service';

export { isManagedVmStageHealthy } from './managed-vm-cluster-health.service';

export const managedVmKubeconfigPath: string = '/etc/rancher/k3s/k3s.yaml';
export const managedVmValuesPath: string = '/etc/compartment/values.yaml';
const k3sConfigPath: string = '/etc/rancher/k3s/config.yaml';
const registryCaPath: string = '/usr/local/share/ca-certificates/compartment-registry-ca.crt';
const registryCaKeyPath: string = '/etc/compartment/registry-ca.key';
const k3sUnitDropInDirectory: string = '/etc/systemd/system/k3s.service.d';

export async function prepareManagedVmHost(
  artifacts: ManagedVmDownloadedArtifacts,
  publicAddress: string,
): Promise<Readonly<Record<string, string>>> {
  const identities: Record<string, string> = {
    '/etc/rancher/k3s': await ensureManagedVmDirectory('/etc/rancher/k3s', 0o700),
    '/etc/compartment': await ensureManagedVmDirectory('/etc/compartment', 0o700),
  };
  Object.assign(identities, await createRegistryCa());
  const k3sConfig: string = renderK3sConfig(publicAddress);
  identities[k3sConfigPath] = await installNewManagedVmFile(k3sConfigPath, k3sConfig, 0o600);
  const values: string = renderManagedVmValues(publicAddress);
  identities[managedVmValuesPath] = await installNewManagedVmFile(managedVmValuesPath, values, 0o600);
  identities['/usr/local/bin/helm'] = await installNewManagedVmFile(
    '/usr/local/bin/helm',
    await readFile(artifacts.helmPath),
    0o755,
  );
  identities['/usr/local/bin/compartment'] = await installNewManagedVmFile(
    '/usr/local/bin/compartment',
    await readFile(process.execPath),
    0o755,
  );
  return identities;
}

export async function installManagedVmK3s(
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<Readonly<Record<string, string>>> {
  const dropInPath: string = `${k3sUnitDropInDirectory}/compartment.conf`;
  const identities: Readonly<Record<string, string>> = {
    '/usr/local/bin/k3s': await installNewManagedVmFile('/usr/local/bin/k3s', await readFile(artifacts.k3sPath), 0o755),
    [k3sUnitDropInDirectory]: await ensureManagedVmDirectory(k3sUnitDropInDirectory, 0o755),
    [dropInPath]: await installNewManagedVmFile(dropInPath, renderK3sUnitDropIn(), 0o644),
  };
  await chmod(artifacts.k3sInstallScriptPath, 0o700);
  await execa('/usr/bin/env', [
    'INSTALL_K3S_SKIP_DOWNLOAD=true',
    `INSTALL_K3S_EXEC=server --config ${k3sConfigPath}`,
    artifacts.k3sInstallScriptPath,
  ]);
  await execa('systemctl', ['daemon-reload']);
  const generatedIdentities: Readonly<Record<string, string>> = await readK3sGeneratedIdentities();
  return { ...identities, ...generatedIdentities };
}

async function readK3sGeneratedIdentities(): Promise<Readonly<Record<string, string>>> {
  const entries: [string, string][] = [];
  for (const path of managedVmK3sGeneratedOwnedPaths) {
    const identity: string | undefined = await readManagedVmPathIdentity(
      path,
      managedVmReleaseMetadata.metadataVersion,
    );
    if (identity === undefined) {
      throw new Error(`The K3s installer did not create the required owned path at ${path}.`);
    }
    entries.push([path, identity]);
  }
  return Object.fromEntries(entries);
}

export async function waitForManagedVmKubernetes(): Promise<void> {
  await execa('k3s', ['kubectl', 'wait', 'node', '--all', '--for=condition=Ready', '--timeout=5m']);
  await execa('k3s', ['kubectl', 'wait', '--for=create', 'serviceaccount/default', '--timeout=5m']);
}

export async function installManagedVmCertManager(manifestPath: string): Promise<void> {
  await execa('k3s', ['kubectl', 'apply', '-f', manifestPath]);
  const deployments: readonly string[] = ['cert-manager', 'cert-manager-webhook', 'cert-manager-cainjector'];
  for (const deployment of deployments) {
    await execa('k3s', [
      'kubectl',
      '--namespace',
      'cert-manager',
      'rollout',
      'status',
      `deployment/${deployment}`,
      '--timeout=5m',
    ]);
  }
}

export async function configureManagedVmRegistryIssuer(): Promise<void> {
  await execa('k3s', ['kubectl', 'create', 'namespace', 'compartment'], { reject: false });
  const secret: ManagedVmCommandResult = await execa('k3s', [
    'kubectl',
    '--namespace',
    'compartment',
    'create',
    'secret',
    'tls',
    'compartment-registry-ca',
    '--cert',
    registryCaPath,
    '--key',
    '/etc/compartment/registry-ca.key',
    '--dry-run=client',
    '-o',
    'yaml',
  ]);
  await execa('k3s', ['kubectl', 'apply', '-f', '-'], { input: secret.stdout });
  await execa('k3s', ['kubectl', 'apply', '-f', '-'], { input: renderRegistryIssuer() });
}

export async function verifyManagedVmPrerequisites(): Promise<void> {
  await waitForManagedVmResource('storageclass/local-path');
  await waitForManagedVmDeployment('coredns');
  await waitForManagedVmDeployment('traefik');
}

async function waitForManagedVmResource(resource: string): Promise<void> {
  await execa('k3s', ['kubectl', 'wait', '--for=create', resource, '--timeout=5m']);
}

async function waitForManagedVmDeployment(deployment: string): Promise<void> {
  await execa('k3s', [
    'kubectl',
    '--namespace',
    'kube-system',
    'wait',
    '--for=create',
    `deployment/${deployment}`,
    '--timeout=5m',
  ]);
  await execa('k3s', [
    'kubectl',
    '--namespace',
    'kube-system',
    'rollout',
    'status',
    `deployment/${deployment}`,
    '--timeout=5m',
  ]);
}

function renderK3sConfig(publicAddress: string): string {
  return `cluster-init: true
secrets-encryption: true
write-kubeconfig-mode: "0600"
node-external-ip: "${publicAddress}"
etcd-snapshot-schedule-cron: "0 */12 * * *"
etcd-snapshot-retention: 5
kubelet-arg:
  - "system-reserved=memory=512Mi"
  - "kube-reserved=memory=512Mi"
  - "eviction-hard=memory.available<512Mi,nodefs.available<10%,imagefs.available<15%,nodefs.inodesFree<5%,imagefs.inodesFree<5%"
`;
}

function renderManagedVmValues(publicAddress: string): string {
  return `ingress:
  className: traefik
  endpoint:
    type: A
    value: ${publicAddress}
storage:
  storageClass: local-path
sandboxRuntime:
  runtimeClassName: gvisor
registry:
  issuerRef:
    kind: Issuer
    name: compartment-registry-ca
`;
}

function renderRegistryIssuer(): string {
  return `apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: compartment-registry-ca
  namespace: compartment
spec:
  ca:
    secretName: compartment-registry-ca
`;
}

async function createRegistryCa(): Promise<Readonly<Record<string, string>>> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-registry-ca-'));
  const temporaryKeyPath: string = join(directory, 'registry-ca.key');
  const temporaryCertificatePath: string = join(directory, 'registry-ca.crt');
  try {
    await generateRegistryCa(temporaryCertificatePath, temporaryKeyPath);
    const identities: Readonly<Record<string, string>> = await installGeneratedRegistryCa(
      temporaryCertificatePath,
      temporaryKeyPath,
    );
    await execa('update-ca-certificates', []);
    return identities;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function generateRegistryCa(certificatePath: string, keyPath: string): Promise<void> {
  await execa('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:3072',
    '-nodes',
    '-days',
    '3650',
    '-subj',
    '/CN=Compartment Registry CA',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
  ]);
}

async function installGeneratedRegistryCa(
  certificatePath: string,
  keyPath: string,
): Promise<Readonly<Record<string, string>>> {
  const certificate: Buffer = await readFile(certificatePath);
  const key: Buffer = await readFile(keyPath);
  return {
    [registryCaPath]: await installNewManagedVmFile(registryCaPath, certificate, 0o644),
    [registryCaKeyPath]: await installNewManagedVmFile(registryCaKeyPath, key, 0o600),
  };
}

export async function verifyManagedVmComponentVersions(): Promise<void> {
  const k3sVersion: ManagedVmCommandResult = await execa('/usr/local/bin/k3s', ['--version']);
  const helmVersion: ManagedVmCommandResult = await execa('/usr/local/bin/helm', ['version', '--short']);
  if (
    !k3sVersion.stdout.includes(managedVmReleaseMetadata.k3sVersion) ||
    !helmVersion.stdout.includes(managedVmReleaseMetadata.helmVersion)
  ) {
    throw new Error('Managed-VM component version verification failed after update.');
  }
  const trustedCa: string = await readFile(registryCaPath, 'utf8');
  if (!trustedCa.includes('BEGIN CERTIFICATE')) {
    throw new Error('Managed-VM registry CA verification failed.');
  }
  await execa('k3s', ['kubectl', 'get', 'storageclass', 'local-path']);
  await execa('k3s', ['kubectl', '--namespace', 'kube-system', 'get', 'deployment', 'coredns']);
  await execa('k3s', ['kubectl', '--namespace', 'kube-system', 'get', 'deployment', 'traefik']);
}

function renderK3sUnitDropIn(): string {
  return `[Unit]
Requires=compartment-firewall.service
After=network-online.target compartment-firewall.service
`;
}
