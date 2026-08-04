import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import { verifyManagedVmFirewall } from './managed-vm-firewall.service';
import type { ManagedVmInstallStage } from './managed-vm-provisioning.types';
import { isManagedVmSandboxRuntimeHealthy } from './managed-vm-sandbox-runtime.service';

const preparedHostPaths: readonly string[] = [
  '/etc/rancher/k3s/config.yaml',
  '/etc/compartment/values.yaml',
  '/usr/local/share/ca-certificates/compartment-registry-ca.crt',
  '/etc/compartment/registry-ca.key',
  '/etc/compartment/firewall.nft',
  '/etc/systemd/system/compartment-firewall.service',
  '/usr/local/bin/helm',
  '/usr/local/bin/compartment',
];

export async function isManagedVmStageHealthy(stage: ManagedVmInstallStage): Promise<boolean> {
  if (stage === 'preparing-host') {
    return await isPreparedHostHealthy();
  }
  if (stage === 'installing-k3s') {
    return await isK3sInstallationHealthy();
  }
  if (stage === 'waiting-for-kubernetes') {
    return await isKubernetesHealthy();
  }
  return await isPostKubernetesStageHealthy(stage);
}

async function isPostKubernetesStageHealthy(stage: ManagedVmInstallStage): Promise<boolean> {
  if (stage === 'installing-sandbox-runtime') {
    return await isManagedVmSandboxRuntimeHealthy();
  }
  if (stage === 'installing-cert-manager') {
    return await isCertManagerHealthy();
  }
  if (stage === 'verifying-prerequisites') {
    return await areManagedVmPrerequisitesHealthy();
  }
  return stage === 'pending' || isPostProvisioningStage(stage);
}

async function isKubernetesHealthy(): Promise<boolean> {
  const result: ManagedVmCommandResult = await execa(
    'k3s',
    ['kubectl', 'wait', 'node', '--all', '--for=condition=Ready', '--timeout=15s'],
    { reject: false },
  );
  return result.exitCode === 0;
}

async function isCertManagerHealthy(): Promise<boolean> {
  return await runHealthChecks(createCertManagerHealthCommands());
}

function createCertManagerHealthCommands(): readonly (readonly string[])[] {
  return [
    ...createCertManagerRolloutCommands(),
    [
      'kubectl',
      '--namespace',
      'compartment',
      'get',
      'secret/compartment-registry-ca',
      'issuer/compartment-registry-ca',
    ],
  ];
}

function createCertManagerRolloutCommands(): readonly (readonly string[])[] {
  return [
    ['kubectl', '--namespace', 'cert-manager', 'rollout', 'status', 'deployment/cert-manager', '--timeout=15s'],
    ['kubectl', '--namespace', 'cert-manager', 'rollout', 'status', 'deployment/cert-manager-webhook', '--timeout=15s'],
    [
      'kubectl',
      '--namespace',
      'cert-manager',
      'rollout',
      'status',
      'deployment/cert-manager-cainjector',
      '--timeout=15s',
    ],
  ];
}

async function areManagedVmPrerequisitesHealthy(): Promise<boolean> {
  const creationCommands: readonly (readonly string[])[] = [
    ['kubectl', 'wait', '--for=create', 'storageclass/local-path', '--timeout=15s'],
    ['kubectl', '--namespace', 'kube-system', 'wait', '--for=create', 'deployment/coredns', '--timeout=15s'],
    ['kubectl', '--namespace', 'kube-system', 'wait', '--for=create', 'deployment/traefik', '--timeout=15s'],
  ];
  if (!(await runHealthChecks(creationCommands))) {
    return false;
  }
  return await runHealthChecks([
    ['kubectl', '--namespace', 'kube-system', 'rollout', 'status', 'deployment/coredns', '--timeout=15s'],
    ['kubectl', '--namespace', 'kube-system', 'rollout', 'status', 'deployment/traefik', '--timeout=15s'],
  ]);
}

async function runHealthChecks(commands: readonly (readonly string[])[]): Promise<boolean> {
  const results: ManagedVmCommandResult[] = await Promise.all(
    commands.map(
      async (args: readonly string[]): Promise<ManagedVmCommandResult> => await execa('k3s', args, { reject: false }),
    ),
  );
  return results.every((result: ManagedVmCommandResult): boolean => result.exitCode === 0);
}

function isPostProvisioningStage(stage: ManagedVmInstallStage): boolean {
  return ['installing-compartment', 'configuring-domain', 'creating-owner', 'complete'].includes(stage);
}

async function isPreparedHostHealthy(): Promise<boolean> {
  if (!(await requiredPathsExist(preparedHostPaths))) {
    return false;
  }
  const config: string = await readFile('/etc/rancher/k3s/config.yaml', 'utf8');
  if (!/node-external-ip: "([^"]+)"/u.test(config)) {
    return false;
  }
  const route: ManagedVmCommandResult = await execa('ip', ['route', 'show', 'default']);
  const publicInterface: string = /\bdev\s+(\S+)/u.exec(route.stdout)?.[1] ?? '';
  const firewallActive: ManagedVmCommandResult = await execa(
    'systemctl',
    ['is-active', 'compartment-firewall.service'],
    { reject: false },
  );
  return (await verifyManagedVmFirewall(publicInterface)) && firewallActive.exitCode === 0;
}

async function isK3sInstallationHealthy(): Promise<boolean> {
  const pathsHealthy: boolean = await requiredPathsExist([
    '/usr/local/bin/k3s',
    '/usr/local/bin/k3s-uninstall.sh',
    '/usr/local/bin/kubectl',
  ]);
  const service: ManagedVmCommandResult = await execa('systemctl', ['is-active', 'k3s'], { reject: false });
  return pathsHealthy && service.exitCode === 0;
}

async function requiredPathsExist(paths: readonly string[]): Promise<boolean> {
  const results: boolean[] = await Promise.all(paths.map(pathExists));
  return results.every(Boolean);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
