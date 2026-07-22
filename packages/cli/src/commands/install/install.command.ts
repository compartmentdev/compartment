import { rm } from 'node:fs/promises';
import type { Command } from 'commander';
import type { CliInstallResult } from '../../install.types';
import { installDev, installKubernetesOwner } from '../../install';
import { runObservableInstallStep } from '../../services/kubernetes-install-progress.service';
import { deployAndWaitForKubernetesInstall } from '../../services/kubernetes-install.service';
import type { KubernetesInstallPreflightResult } from '../../services/kubernetes-install-preflight.service.types';
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
  InstallWizardResolution,
  KubernetesInstallTargetOptions,
  PreparedInstallCommandInput,
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
import {
  materializeInstallWizardValues,
  removeInstallWizardValues,
  type MaterializedInstallWizardValues,
} from './install.command.values';
import { resolveInstallWizard } from './install.command.wizard';

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
  renderInstallResult(dependencies.io, options.output, result, true);
}

async function executeKubernetesInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const target: KubernetesInstallTargetOptions = resolveKubernetesInstallTargetOptions(options);
  const guidedInstall: boolean = options.values === undefined && hasInteractiveInput(dependencies);
  const writePreflightOutput: (value: string) => void = (value: string): void => {
    if (guidedInstall || !value.startsWith('✓ ')) {
      dependencies.io.stderr(value);
    }
  };
  const checklist: InstallPreflightChecklistResult = await runInstallPreflightChecklist(
    { ...dependencies, io: { ...dependencies.io, stderr: writePreflightOutput } },
    target,
    guidedInstall,
    guidedInstall,
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
  const prepared: PreparedInstallCommandInput = await resolveGuidedInstallInput(
    dependencies,
    options,
    checklist.preflight,
  );
  try {
    const completed: PreparedKubernetesInstallResult = await executePreparedKubernetesInstall(
      dependencies,
      prepared.options,
      checklist.kubeconfig.path,
    );
    await completePreparedKubernetesInstall(dependencies, options, completed);
  } finally {
    if (prepared.material !== null) {
      await removeInstallWizardValues(prepared.material);
    }
  }
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

async function resolveGuidedInstallInput(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  preflight: KubernetesInstallPreflightResult,
): Promise<PreparedInstallCommandInput> {
  if (options.values !== undefined) {
    return { material: null, options: { ...options, values: options.values } };
  }
  assertInteractiveInstall(dependencies);
  const wizard: InstallWizardResolution = await resolveInstallWizard(dependencies.io, preflight.storageClass);
  const material: MaterializedInstallWizardValues = await materializeInstallWizardValues(wizard.values);
  return {
    material,
    options: {
      ...options,
      ...(wizard.answers.baseDomain === undefined ? {} : { baseDomain: wizard.answers.baseDomain }),
      managedDomain: wizard.answers.domainMode === 'managed',
      values: material.path,
    },
  };
}

function assertInteractiveInstall(dependencies: CliCommandDependencies): void {
  if (hasInteractiveInput(dependencies)) {
    return;
  }
  throw new Error(
    '--values is required when running non-interactively. A minimal values file:\n' +
      'storage:\n  storageClass: local-path\nplatform:\n  logLevel: info\n' +
      'Or run `compartment install` from an interactive terminal for the guided setup.',
  );
}

function hasInteractiveInput(dependencies: CliCommandDependencies): boolean {
  return (dependencies.io.stdin as { isTTY?: boolean | undefined }).isTTY === true;
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
