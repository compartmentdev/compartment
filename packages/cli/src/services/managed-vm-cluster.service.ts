import { access, chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import type { ManagedVmDownloadedArtifacts } from './managed-vm-artifacts.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';

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
): Promise<void> {
  await Promise.all([
    mkdir('/etc/rancher/k3s', { mode: 0o700, recursive: true }),
    mkdir('/etc/compartment', { mode: 0o700, recursive: true }),
  ]);
  if (!(await requiredPathsExist([registryCaPath, registryCaKeyPath]))) {
    await createRegistryCa();
  }
  await writeFile(k3sConfigPath, renderK3sConfig(publicAddress), { mode: 0o600 });
  await writeFile(managedVmValuesPath, renderManagedVmValues(publicAddress), { mode: 0o600 });
  await installManagedVmHelm(artifacts);
  await installManagedVmPackagedCli();
  await chmod('/usr/local/bin/compartment', 0o755);
}

async function installManagedVmPackagedCli(): Promise<void> {
  const destination: string = '/usr/local/bin/compartment';
  if (await pathsIdentifySameFile(process.execPath, destination)) {
    return;
  }
  await copyFile(process.execPath, destination);
}

async function pathsIdentifySameFile(source: string, destination: string): Promise<boolean> {
  try {
    const [sourceStats, destinationStats]: [Stats, Stats] = await Promise.all([stat(source), stat(destination)]);
    return sourceStats.dev === destinationStats.dev && sourceStats.ino === destinationStats.ino;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function installManagedVmHelm(artifacts: ManagedVmDownloadedArtifacts): Promise<void> {
  await copyFile(artifacts.helmPath, '/usr/local/bin/helm');
  await chmod('/usr/local/bin/helm', 0o755);
}

export async function installManagedVmK3s(artifacts: ManagedVmDownloadedArtifacts): Promise<void> {
  await copyFile(artifacts.k3sPath, '/usr/local/bin/k3s');
  await chmod('/usr/local/bin/k3s', 0o755);
  await mkdir(k3sUnitDropInDirectory, { mode: 0o755, recursive: true });
  await writeFile(`${k3sUnitDropInDirectory}/compartment.conf`, renderK3sUnitDropIn(), { mode: 0o644 });
  await chmod(artifacts.k3sInstallScriptPath, 0o700);
  await execa('/usr/bin/env', [
    'INSTALL_K3S_SKIP_DOWNLOAD=true',
    `INSTALL_K3S_EXEC=server --config ${k3sConfigPath}`,
    artifacts.k3sInstallScriptPath,
  ]);
  await execa('systemctl', ['daemon-reload']);
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

async function createRegistryCa(): Promise<void> {
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
    registryCaKeyPath,
    '-out',
    registryCaPath,
  ]);
  await chmod('/etc/compartment/registry-ca.key', 0o600);
  await execa('update-ca-certificates', []);
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

async function requiredPathsExist(paths: readonly string[]): Promise<boolean> {
  const results: boolean[] = await Promise.all(
    paths.map(async (path: string): Promise<boolean> => {
      try {
        await access(path, constants.R_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
}
