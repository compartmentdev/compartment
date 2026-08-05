import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from '../../services/managed-vm-command.service';
import { promptMutationConfirmation } from '../../prompts/prompt';
import { managedVmValuesPath } from '../../services/managed-vm-cluster.service';
import {
  inspectManagedVmHost,
  inspectManagedVmState,
  observePublicIpv4,
} from '../../services/managed-vm-host-runtime.service';
import { assertManagedVmPreflight, evaluateManagedVmPreflight } from '../../services/managed-vm-preflight.service';
import type {
  ManagedVmPreflightCheckStatus,
  ManagedVmPreflightResult,
  ManagedVmInstallStage,
  ManagedVmProvisionerState,
} from '../../services/managed-vm-provisioning.types';
import { provisionManagedVmCluster } from '../../services/managed-vm-provisioner.service';
import { persistManagedVmStage } from '../../services/managed-vm-state.service';
import type { CliCommandDependencies } from '../command.types';
import { resolveInstallIdentityPrompts, withResolvedInstallIdentity } from './install.command.identity';
import { executeCanonicalKubernetesInstallCommand } from './install.command.kubernetes';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';
import { promptCanonicalInstallDomain } from './install.command.kubernetes-wizard-domain';
import type { KubernetesInstallDomainInput } from '../../services/kubernetes-install-input.service.types';
import { buildManagedVmReview, parseManagedVmObservedAddress } from './install.command.vm.helpers';

const observationUrl: string = 'https://1.1.1.1/cdn-cgi/trace';
const preflightStatusIcons: Readonly<Record<ManagedVmPreflightCheckStatus, string>> = {
  failed: '✗',
  passed: '✓',
  warning: '⚠',
};

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
  const resolvedOptions: InstallCommandOptions = await resolveManagedVmDomainOptions(dependencies, options);
  const identity: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, resolvedOptions);
  renderManagedVmReview(dependencies, preflight, identity, resolvedOptions);
  const confirmed: boolean = options.yes === true || (await promptMutationConfirmation(dependencies.io));
  if (!confirmed) {
    throw new Error('Installation cancelled before host changes.');
  }
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    await runPrivilegedManagedVmInstall(
      dependencies,
      withResolvedInstallIdentity(resolvedOptions, identity),
      preflight,
    );
    return;
  }
  await reexecManagedVmInstall(dependencies, resolvedOptions, identity);
}

async function resolveManagedVmDomainOptions(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<InstallCommandOptions> {
  if (options.managedDomain === true || options.baseDomain !== undefined) {
    return options;
  }
  const domain: KubernetesInstallDomainInput = await promptCanonicalInstallDomain(dependencies.io);
  return domain.mode === 'managed'
    ? { ...options, managedDomain: true }
    : { ...options, baseDomain: domain.baseDomain };
}

async function runManagedVmPreflight(): Promise<ManagedVmPreflightResult> {
  const [inventory, state, publicAddress] = await Promise.all([
    inspectManagedVmHost(),
    inspectManagedVmState(),
    observePublicIpv4(observationUrl).then(parseManagedVmObservedAddress),
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
  await executeManagedVmPlatformInstall(dependencies, options, preflight, adminPassword);
  await persistManagedVmStage(state, 'complete');
}

async function executeManagedVmPlatformInstall(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  preflight: ManagedVmPreflightResult,
  adminPassword: string | undefined,
): Promise<void> {
  await executeCanonicalKubernetesInstallCommand(dependencies, {
    ...options,
    adminPassword,
    check: false,
    ingressClass: 'traefik',
    ingressEndpoint: preflight.publicAddress,
    kubeContext: 'default',
    storageClass: 'local-path',
    values: managedVmValuesPath,
  });
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
    ...buildPrivilegedCommandArgs(dependencies, options, handoffPath),
    ...buildPrivilegedIdentityArgs(identity, passwordPath),
    '--output',
    options.output,
  ];
}

function buildPrivilegedCommandArgs(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  handoffPath: string,
): string[] {
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
    ...buildPrivilegedDomainArgs(options),
  ];
}

function buildPrivilegedDomainArgs(options: InstallCommandOptions): string[] {
  if (options.managedDomain === true) {
    return ['--managed-domain'];
  }
  if (options.baseDomain === undefined) {
    throw new Error('Managed VM domain must be resolved before privileged installation.');
  }
  return ['--base-domain', options.baseDomain];
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
    dependencies.io.stderr(`  ${preflightStatusIcons[check.status]} ${check.detail}\n`);
  }
}

function renderManagedVmReview(
  dependencies: CliCommandDependencies,
  preflight: ManagedVmPreflightResult,
  identity: ResolvedInstallIdentityPrompts,
  options: InstallCommandOptions,
): void {
  dependencies.io.stderr(buildManagedVmReview(preflight, identity, options));
}
