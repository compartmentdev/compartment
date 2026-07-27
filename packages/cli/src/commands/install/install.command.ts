import { rm } from 'node:fs/promises';
import type { Command } from 'commander';
import type { CliInstallResult } from '../../install.types';
import { installDev, installKubernetesOwner } from '../../install';
import { runObservableInstallStep } from '../../services/kubernetes-install-progress.service';
import { deployAndWaitForKubernetesInstall } from '../../services/kubernetes-install.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
} from '../../services/kubernetes-install.service.types';
import type { CliCommandDependencies } from '../command.types';
import { createCommandProgress } from '../command.progress';
import type { CommandProgress } from '../command.progress.types';
import { buildOwnerInstallInput, resolveInstallIdentityPrompts } from './install.command.identity';
import { finishDiscoveredInstallRegistryMirrorSetup } from './install.command.registry-mirror';
import { readManagedDomainRequestedLabelSource } from './install.command.managed-domain';
import { runInstallPreflightChecklist } from './install.command.preflight';
import { renderInstallResult } from './install.command.result';
import { persistDevInstallSession, persistInstallSession } from './install.command.session';
import type {
  InstallCommandOptions,
  InstallPreflightChecklistResult,
  KubernetesInstallTargetOptions,
  PreparedKubernetesInstallCommandOptions,
  PreparedKubernetesInstallResult,
  ResolvedInstallIdentityPrompts,
  ResolvedKubernetesInstallCommandOptions,
} from './install.command.types';
import {
  assertDevInstallOptions,
  resolveKubernetesInstallCommandOptions,
  resolveKubernetesInstallTargetOptions,
} from './install.command.validation';
import { executeCanonicalKubernetesInstallCommand } from './install.command.kubernetes';

export function registerInstallCommand(program: Command, dependencies: CliCommandDependencies): void {
  const command: Command = program
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
    .option('--admin-password <password>', 'First admin password (automation only)')
    .option('--organization <name>', 'First organization name')
    .option('--organization-slug <slug>')
    .option('--remote <name>', 'Remote name for the saved CLI session')
    .option('--output <format>', 'text or json', 'text');
  addCanonicalInstallOptions(command).action(
    async (options: InstallCommandOptions): Promise<void> => await executeInstallCommand(dependencies, options),
  );
}

function addCanonicalInstallOptions(command: Command): Command {
  return command
    .option('--ingress-class <name>', 'IngressClass used for public Compartment hosts')
    .option('--storage-class <name>', 'StorageClass used for persistent platform data')
    .option('--ingress-endpoint <address>', 'Explicit ingress address when status is not published');
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
  renderInstallResult(dependencies.io, options.output, result, true);
}

async function executeKubernetesInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  if (options.values === undefined) {
    await executeCanonicalKubernetesInstallCommand(dependencies, options);
    return;
  }
  await executeLegacyKubernetesInstallCommand(dependencies, options);
}

async function executeLegacyKubernetesInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const target: KubernetesInstallTargetOptions = resolveKubernetesInstallTargetOptions(options);
  const writePreflightOutput: (value: string) => void = (value: string): void => {
    if (!value.startsWith('✓ ')) {
      dependencies.io.stderr(value);
    }
  };
  const checklist: InstallPreflightChecklistResult = await runInstallPreflightChecklist(
    { ...dependencies, io: { ...dependencies.io, stderr: writePreflightOutput } },
    target,
    false,
    false,
  );
  try {
    await executeChecklistInstall(dependencies, options, checklist);
  } finally {
    await removeMaterializedKubeconfig(checklist);
  }
}

async function executeChecklistInstall(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  checklist: InstallPreflightChecklistResult,
): Promise<void> {
  const prepared: PreparedKubernetesInstallCommandOptions = { ...options, values: options.values! };
  const completed: PreparedKubernetesInstallResult = await executePreparedKubernetesInstall(
    dependencies,
    prepared,
    checklist.kubeconfig.path,
  );
  await completePreparedKubernetesInstall(dependencies, options, completed);
}

async function completePreparedKubernetesInstall(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  completed: PreparedKubernetesInstallResult,
): Promise<void> {
  await finishDiscoveredInstallRegistryMirrorSetup(
    dependencies.io,
    completed.installOptions,
    options.skipRegistryMirror === true,
    options.values !== undefined,
  );
  await persistInstallSession(completed.result, options.remote);
  renderInstallResult(dependencies.io, options.output, completed.result, false);
}

async function removeMaterializedKubeconfig(checklist: InstallPreflightChecklistResult): Promise<void> {
  if (checklist.kubeconfig.materializedDirectory !== undefined) {
    await rm(checklist.kubeconfig.materializedDirectory, { force: true, recursive: true });
  }
}

async function executePreparedKubernetesInstall(
  dependencies: CliCommandDependencies,
  options: PreparedKubernetesInstallCommandOptions,
  kubeconfigPath: string,
): Promise<PreparedKubernetesInstallResult> {
  const installOptions: ResolvedKubernetesInstallCommandOptions = resolveKubernetesInstallCommandOptions(
    options,
    kubeconfigPath,
  );
  const prompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  const progress: CommandProgress = createCommandProgress({ io: dependencies.io, output: options.output });
  let result: CliInstallResult;
  try {
    result = await installKubernetesPlatformAndOwner(installOptions, prompts, options, progress);
  } finally {
    progress.stop();
  }
  return { installOptions, result };
}

async function installKubernetesPlatformAndOwner(
  installOptions: ResolvedKubernetesInstallCommandOptions,
  prompts: ResolvedInstallIdentityPrompts,
  options: InstallCommandOptions,
  progress: CommandProgress,
): Promise<CliInstallResult> {
  const deploymentInput: KubernetesInstallDeploymentInput = {
    ...buildKubernetesInstallDeploymentInput(installOptions, prompts, options.organizationSlug),
    progress,
  };
  const deployment: KubernetesInstallDeploymentResult = await deployAndWaitForKubernetesInstall(deploymentInput);
  return await runObservableInstallStep(
    progress,
    'Creating owner',
    async (): Promise<CliInstallResult> =>
      await installKubernetesOwner(deployment.apiUrl, deployment.installToken, {
        ...buildOwnerInstallInput(prompts, options),
        baseDomain: deployment.baseDomain,
      }),
  );
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
