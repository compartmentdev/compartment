import type { Command } from 'commander';
import type { CliInstallResult } from '../../install.types';
import { installDev, installKubernetesOwner } from '../../install';
import { renderOutput } from '../../output/render';
import { deployAndWaitForKubernetesInstall } from '../../services/kubernetes-install.service';
import { readInstalledKubernetesRegistryMirror } from '../../services/kubernetes-registry-mirror.service';
import type { KubernetesRegistryMirror } from '../../services/kubernetes-registry-mirror.service.types';
import type { InstallInput } from '../../services/install.service.types';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
} from '../../services/kubernetes-install.service.types';
import type { CliCommandDependencies } from '../command.types';
import { resolveInstallIdentityPrompts } from './install.command.identity';
import { finishInstallRegistryMirrorSetup } from './install.command.registry-mirror';
import { readManagedDomainRequestedLabelSource } from './install.command.managed-domain';
import { createInstallResultMessage, toInstallResponse } from './install.command.result';
import { persistDevInstallSession, persistInstallSession } from './install.command.session';
import type {
  InstallCommandOptions,
  ResolvedInstallIdentityPrompts,
  ResolvedKubernetesInstallCommandOptions,
} from './install.command.types';
import { assertDevInstallOptions, resolveKubernetesInstallCommandOptions } from './install.command.validation';

export function registerInstallCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('install')
    .option('--dev', 'Install against the local repo dev API')
    .option('--api-url <url>', 'Public Console URL for the Kubernetes installation')
    .option('--base-domain <domain>', 'Base domain configured for the Kubernetes installation')
    .option('--managed-domain', 'Allocate a managed installation domain (default when --base-domain is omitted)')
    .option('--broker-url <url>', 'Managed-domain broker URL')
    .option('--values <path>', 'Operator values file for the Compartment Helm chart')
    .option('--chart <path>', 'Compartment Helm chart path for a source CLI build')
    .option('--kube-context <name>', 'Kubernetes context for Helm')
    .option('--namespace <name>', 'Kubernetes namespace; defaults to compartment')
    .option('--release-name <name>', 'Helm release name; defaults to compartment')
    .option('--skip-registry-mirror', 'Do not automatically configure the local k3s registry mirror')
    .option('--email <email>', 'First admin email')
    .option('--organization <name>', 'First organization name')
    .option('--organization-slug <slug>')
    .option('--remote <name>', 'Remote name for the saved CLI session')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: InstallCommandOptions): Promise<void> => await executeInstallCommand(dependencies, options),
    );
}

async function executeInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  if (options.dev === true) {
    await executeDevInstallCommand(dependencies, options);
    return;
  }

  await executeKubernetesInstallCommand(dependencies, options);
}

async function executeDevInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  assertDevInstallOptions(options);
  const prompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  const result: CliInstallResult = await installDev(buildOwnerInstallInput(prompts, options));

  await persistDevInstallSession(result, options.remote);
  renderInstallResult(dependencies, options, result, true);
}

async function executeKubernetesInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const installOptions: ResolvedKubernetesInstallCommandOptions = resolveKubernetesInstallCommandOptions(options);
  const prompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  dependencies.io.stderr('Installing the Compartment platform with Helm...\n');
  const deploymentInput: KubernetesInstallDeploymentInput = buildKubernetesInstallDeploymentInput(
    installOptions,
    prompts,
    options.organizationSlug,
  );
  const deployment: KubernetesInstallDeploymentResult = await deployAndWaitForKubernetesInstall(deploymentInput);
  const registryMirror: KubernetesRegistryMirror = await readInstalledKubernetesRegistryMirror(installOptions);

  const result: CliInstallResult = await installKubernetesOwner(deployment.apiUrl, deployment.installToken, {
    ...buildOwnerInstallInput(prompts, options),
    baseDomain: deployment.baseDomain,
  });

  await completeKubernetesInstall(dependencies, options, installOptions, registryMirror, result);
}

async function completeKubernetesInstall(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  installOptions: ResolvedKubernetesInstallCommandOptions,
  registryMirror: KubernetesRegistryMirror,
  result: CliInstallResult,
): Promise<void> {
  await persistInstallSession(result, options.remote);
  await finishInstallRegistryMirrorSetup(
    dependencies.io,
    installOptions,
    registryMirror,
    options.skipRegistryMirror === true,
  );
  renderInstallResult(dependencies, options, result, false);
}

function buildKubernetesInstallDeploymentInput(
  installOptions: ResolvedKubernetesInstallCommandOptions,
  prompts: ResolvedInstallIdentityPrompts,
  organizationSlug: string | undefined,
): KubernetesInstallDeploymentInput {
  return {
    ...installOptions,
    acmeEmail: prompts.adminEmail,
    ...(installOptions.domainMode === 'managed'
      ? {
          managedDomainRequestedLabelSource: readManagedDomainRequestedLabelSource(
            prompts.organizationName,
            organizationSlug,
          ),
        }
      : {}),
  };
}

function buildOwnerInstallInput(
  prompts: ResolvedInstallIdentityPrompts,
  options: InstallCommandOptions,
): Omit<InstallInput, 'baseDomain'> {
  return {
    adminEmail: prompts.adminEmail,
    adminPassword: prompts.adminPassword,
    organizationName: prompts.organizationName,
    ...(options.organizationSlug === undefined ? {} : { organizationSlug: options.organizationSlug }),
  };
}

function renderInstallResult(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  result: CliInstallResult,
  development: boolean,
): void {
  renderOutput(
    dependencies.io,
    options.output,
    toInstallResponse(result),
    createInstallResultMessage(result, development),
  );
}
