import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execa } from '../../services/managed-vm-command.service';
import { promptMutationConfirmation } from '../../prompts/prompt';
import { managedVmKubeconfigPath, managedVmValuesPath } from '../../services/managed-vm-cluster.service';
import {
  inspectManagedVmHost,
  inspectManagedVmState,
  observePublicIpv4,
} from '../../services/managed-vm-host-runtime.service';
import { assertManagedVmPreflight, evaluateManagedVmPreflight } from '../../services/managed-vm-preflight.service';
import type {
  ManagedVmPreflightResult,
  ManagedVmInstallStage,
  ManagedVmObservedState,
  ManagedVmProvisionerState,
} from '../../services/managed-vm-provisioning.types';
import { provisionManagedVmCluster } from '../../services/managed-vm-provisioner.service';
import { renderManagedVmFirewallRules } from '../../services/managed-vm-firewall.service';
import { persistManagedVmStage } from '../../services/managed-vm-state.service';
import { selectInstallTarget, type InstallTarget } from '../../services/managed-vm-target.service';
import type { CliCommandDependencies } from '../command.types';
import { resolveInstallIdentityPrompts } from './install.command.identity';
import { executeCanonicalKubernetesInstallCommand } from './install.command.kubernetes';
import type {
  InstallCommandOptions,
  InstallInputStream,
  ResolvedInstallIdentityPrompts,
} from './install.command.types';

const observationUrl: string = 'https://compartment.dev/cdn-cgi/trace';

export async function resolveInstallCommandTarget(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<InstallTarget> {
  const state: ManagedVmObservedState = await inspectManagedVmState();
  return await selectInstallTarget({
    explicitTarget: options.target,
    interactive: (dependencies.io.stdin as InstallInputStream).isTTY === true,
    kubeconfigPaths: readKubeconfigCandidates(options.kubeContext),
    managedStateExists: state.provisionerStateExists,
  });
}

export async function executeManagedVmInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const preflight: ManagedVmPreflightResult = await runManagedVmPreflight();
  renderManagedVmPreflight(dependencies, options, preflight);
  assertManagedVmPreflight(preflight);
  if (options.check === true) {
    return;
  }
  await executeManagedVmMutation(dependencies, options, preflight);
}

async function executeManagedVmMutation(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  preflight: ManagedVmPreflightResult,
): Promise<void> {
  if (options.privilegedVmInstall === true) {
    await consumePrivilegedHandoff(options.privilegedVmHandoff);
    await runPrivilegedManagedVmInstall(dependencies, options, preflight);
    return;
  }
  await reviewAndExecuteManagedVmMutation(dependencies, options, preflight);
}

async function reviewAndExecuteManagedVmMutation(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  preflight: ManagedVmPreflightResult,
): Promise<void> {
  const identity: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  renderManagedVmReview(dependencies, preflight, identity);
  const confirmed: boolean = options.yes === true || (await promptMutationConfirmation(dependencies.io));
  if (!confirmed) {
    throw new Error('Installation cancelled before host changes.');
  }
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    await runPrivilegedManagedVmInstall(dependencies, { ...options, adminPassword: identity.adminPassword }, preflight);
    return;
  }
  await reexecManagedVmInstall(dependencies, options, identity);
}

async function runManagedVmPreflight(): Promise<ManagedVmPreflightResult> {
  const [inventory, state, publicAddress] = await Promise.all([
    inspectManagedVmHost(),
    inspectManagedVmState(),
    observePublicIpv4(observationUrl).then(parseObservedAddress),
  ]);
  return evaluateManagedVmPreflight(inventory, state, publicAddress);
}

async function runPrivilegedManagedVmInstall(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  preflight: ManagedVmPreflightResult,
): Promise<void> {
  const state: ManagedVmProvisionerState = await provisionManagedVmCluster({
    publicAddress: preflight.publicAddress,
    publicInterface: preflight.inventory.publicInterface,
    reportStage: (stage: ManagedVmInstallStage): void => dependencies.io.stderr(`  ${stage}\n`),
  });
  const adminPassword: string | undefined = await readPrivilegedAdminPassword(options);
  await executeCanonicalKubernetesInstallCommand(dependencies, {
    ...options,
    adminPassword,
    check: false,
    ingressClass: 'traefik',
    ingressEndpoint: preflight.publicAddress,
    kubeContext: 'default',
    managedDomain: true,
    storageClass: 'local-path',
    values: managedVmValuesPath,
  });
  await persistManagedVmStage(state, 'complete');
}

async function readPrivilegedAdminPassword(options: InstallCommandOptions): Promise<string | undefined> {
  if (options.adminPassword !== undefined) {
    return options.adminPassword;
  }
  const path: string | undefined = options.adminPasswordFile;
  return path === undefined || path === '-' ? undefined : (await readFile(path, 'utf8')).trim();
}

async function reexecManagedVmInstall(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  identity: ResolvedInstallIdentityPrompts,
): Promise<void> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-owner-'));
  const passwordPath: string = join(directory, 'password');
  const handoffPath: string = join(directory, 'confirmed');
  try {
    await writeFile(passwordPath, identity.adminPassword, { mode: 0o600 });
    await writeFile(handoffPath, 'mutation-review-confirmed\n', { mode: 0o600 });
    const args: string[] = buildPrivilegedArgs(dependencies, options, identity, passwordPath, handoffPath);
    await execa('sudo', args, { stdio: 'inherit' });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function buildPrivilegedArgs(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  identity: ResolvedInstallIdentityPrompts,
  passwordPath: string,
  handoffPath: string,
): string[] {
  return [
    ...buildPrivilegedCommandArgs(dependencies, handoffPath),
    ...buildPrivilegedIdentityArgs(identity, passwordPath),
    '--output',
    options.output,
  ];
}

function buildPrivilegedCommandArgs(dependencies: CliCommandDependencies, handoffPath: string): string[] {
  return [
    '--',
    ...dependencies.commandPrefix,
    'install',
    '--target',
    'vm',
    '--privileged-vm-install',
    '--privileged-vm-handoff',
    handoffPath,
    '--yes',
    '--managed-domain',
  ];
}

function buildPrivilegedIdentityArgs(identity: ResolvedInstallIdentityPrompts, passwordPath: string): string[] {
  return [
    '--email',
    identity.adminEmail,
    '--organization',
    identity.organizationName,
    '--admin-password-file',
    passwordPath,
  ];
}

async function consumePrivilegedHandoff(path: string | undefined): Promise<void> {
  if (path === undefined) {
    throw new Error('Privileged VM installation requires a confirmed secure handoff.');
  }
  const [metadata, contents] = await Promise.all([stat(path), readFile(path, 'utf8')]);
  const invokingUid: number = Number(process.env.SUDO_UID);
  if (
    !Number.isSafeInteger(invokingUid) ||
    metadata.uid !== invokingUid ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.nlink !== 1 ||
    contents !== 'mutation-review-confirmed\n'
  ) {
    throw new Error('Privileged VM installation handoff is invalid.');
  }
  await rm(path);
}

function renderManagedVmPreflight(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  result: ManagedVmPreflightResult,
): void {
  if (options.output === 'json') {
    dependencies.io.stdout(`${JSON.stringify(result)}\n`);
    return;
  }
  dependencies.io.stderr('Checking this VM\n');
  for (const check of result.checks) {
    dependencies.io.stderr(`  ${check.passed ? '✓' : '✗'} ${check.detail}\n`);
  }
}

function renderManagedVmReview(
  dependencies: CliCommandDependencies,
  preflight: ManagedVmPreflightResult,
  identity: ResolvedInstallIdentityPrompts,
): void {
  dependencies.io.stderr(`\nInstallation review
  Target: this VM
  Kubernetes: k3s ${preflight.metadata.k3sChannel}, single node, embedded etcd
  Kubernetes compatibility: minor ${preflight.metadata.kubernetesMinor} and required capabilities
  Domain: managed
  Owner: ${identity.adminEmail}
  Organization: ${identity.organizationName}

Host changes
  /usr/local/bin/compartment, k3s, helm
  /etc/compartment and /etc/rancher/k3s
  /var/lib/rancher/k3s and /var/lib/compartment/installer
  systemd services: compartment-firewall, k3s
  Firewall rules on ${preflight.inventory.publicInterface}:
${indent(renderManagedVmFirewallRules(preflight.inventory.publicInterface), '    ')}
`);
}

function readKubeconfigCandidates(configuredContext: string | undefined): readonly string[] {
  const configured: string | undefined = process.env.KUBECONFIG;
  const paths: readonly string[] = configured?.split(delimiter).filter((path: string): boolean => path !== '') ?? [
    join(homedir(), '.kube', 'config'),
  ];
  return configuredContext !== undefined && configured !== undefined ? paths : [...paths, managedVmKubeconfigPath];
}

function parseObservedAddress(body: string): string {
  const traceAddress: string | undefined = body
    .split('\n')
    .find((line: string): boolean => line.startsWith('ip='))
    ?.slice(3);
  return traceAddress ?? body;
}

function indent(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line: string): string => `${prefix}${line}`)
    .join('\n');
}
