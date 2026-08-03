import type {
  KubernetesSystemRestartResponse,
  KubernetesSystemStatusResponse,
  KubernetesSystemUpdateResponse,
  KubernetesPlatformWorkloadStatus,
} from '@compartment/contracts';
import type { Command } from 'commander';
import { readCliVersion } from '../../cli-build-info';
import { renderOutput } from '../../output/render';
import {
  getKubernetesSystemStatus,
  restartKubernetesSystem,
  updateKubernetesSystem,
} from '../../services/kubernetes-system-lifecycle.service';
import type { KubernetesOperatorTarget } from '../../services/kubernetes-operator.service.types';
import { withResolvedKubernetesOperatorTarget } from '../../services/kubernetes-operator-target.service';
import type { CliCommandDependencies } from '../command.types';
import {
  addKubernetesOperatorTargetOptions,
  addKubernetesOperatorReleaseOptions,
  resolveKubernetesOperatorTarget,
  resolveKubernetesSystemUpdateVersion,
} from './system.command.options';
import type {
  KubernetesOperatorCommandOptions,
  KubernetesSystemUpdateCommandOptions,
  ManagedVmCompositeSystemStatus,
  ManagedVmDiagnoseCommandOptions,
  ManagedVmResetCommandOptions,
} from './system.command.types';
import { createKubernetesSystemUpdateMessage } from './system.command.output';
import {
  getManagedVmSystemStatus,
  resetManagedVmInstallation,
  updateManagedVmInstallation,
} from '../../services/managed-vm-lifecycle.service';
import { hasManagedVmInstallation } from '../../services/managed-vm-installation.service';
import { createManagedVmDiagnosis } from '../../services/managed-vm-diagnosis.service';
import { managedVmKubeconfigPath, managedVmValuesPath } from '../../services/managed-vm-cluster.service';
import type { ManagedVmDiagnoseResult, ManagedVmSystemStatus } from '../../services/managed-vm-lifecycle.service.types';

export function registerKubernetesSystemLifecycleCommands(
  program: Command,
  dependencies: CliCommandDependencies,
): void {
  registerStatusCommand(program, dependencies);
  registerRestartCommand(program, dependencies);
  registerUpdateCommand(program, dependencies);
  registerDiagnoseCommand(program, dependencies);
  registerResetCommand(program, dependencies);
}

function registerStatusCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorTargetOptions(
    program.command('status').description('Show Helm release status and platform workload readiness'),
  ).action(
    async (options: KubernetesOperatorCommandOptions): Promise<void> =>
      await executeStatusCommand(dependencies, options),
  );
}

async function executeStatusCommand(
  dependencies: CliCommandDependencies,
  options: KubernetesOperatorCommandOptions,
): Promise<void> {
  if (await hasManagedVmInstallation()) {
    await renderManagedVmStatus(dependencies, options);
    return;
  }
  const result: KubernetesSystemStatusResponse = await withResolvedKubernetesOperatorTarget(
    resolveKubernetesOperatorTarget(options),
    getKubernetesSystemStatus,
  );
  renderOutput(dependencies.io, options.output, result, createStatusMessage(result));
}

async function renderManagedVmStatus(
  dependencies: CliCommandDependencies,
  options: KubernetesOperatorCommandOptions,
): Promise<void> {
  const host: ManagedVmSystemStatus = await getManagedVmSystemStatus();
  const platform: KubernetesSystemStatusResponse = await getKubernetesSystemStatus({
    kubeconfigPath: managedVmKubeconfigPath,
    namespace: options.namespace ?? 'compartment',
    releaseName: options.releaseName ?? 'compartment',
  });
  const result: ManagedVmCompositeSystemStatus = { host, platform };
  renderOutput(
    dependencies.io,
    options.output,
    result,
    `${createManagedHostStatusMessage(host)}\n${createStatusMessage(platform)}`,
  );
}

function registerRestartCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorTargetOptions(
    program.command('restart').description('Restart platform workloads and wait for their rollout'),
  ).action(async (options: KubernetesOperatorCommandOptions): Promise<void> => {
    const result: KubernetesSystemRestartResponse = await withResolvedKubernetesOperatorTarget(
      resolveKubernetesOperatorTarget(options),
      restartKubernetesSystem,
    );
    renderOutput(dependencies.io, options.output, result, createRestartMessage(result));
  });
}

function registerUpdateCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorReleaseOptions(
    program
      .command('update')
      .description('Verify images, update the Kubernetes platform, and run database migrations')
      .option('--version <version>', 'Platform image tag; defaults to the packaged CLI release'),
  ).action(async (options: KubernetesSystemUpdateCommandOptions): Promise<void> => {
    const version: string = resolveKubernetesSystemUpdateVersion(options.version);
    if (await hasManagedVmInstallation()) {
      await executeManagedVmUpdate(dependencies, options, version);
      return;
    }
    await executeExistingKubernetesUpdate(dependencies, options, version);
  });
}

async function executeManagedVmUpdate(
  dependencies: CliCommandDependencies,
  options: KubernetesSystemUpdateCommandOptions,
  version: string,
): Promise<void> {
  const result: KubernetesSystemUpdateResponse = await updateManagedVmInstallation(
    async (): Promise<KubernetesSystemUpdateResponse> =>
      await updateKubernetesSystem({
        kubeconfigPath: managedVmKubeconfigPath,
        namespace: options.namespace ?? 'compartment',
        releaseName: options.releaseName ?? 'compartment',
        valuesPath: managedVmValuesPath,
        version,
      }),
    async (): Promise<KubernetesSystemUpdateResponse> => await readManagedVmUpdateResult(options, version),
  );
  renderOutput(
    dependencies.io,
    options.output,
    result,
    createKubernetesSystemUpdateMessage(result, readCliVersion(), createStatusMessage(result.status)),
  );
}

async function readManagedVmUpdateResult(
  options: KubernetesSystemUpdateCommandOptions,
  version: string,
): Promise<KubernetesSystemUpdateResponse> {
  const status: KubernetesSystemStatusResponse = await getKubernetesSystemStatus({
    kubeconfigPath: managedVmKubeconfigPath,
    namespace: options.namespace ?? 'compartment',
    releaseName: options.releaseName ?? 'compartment',
  });
  return { status, updated: status.ready, version };
}

async function executeExistingKubernetesUpdate(
  dependencies: CliCommandDependencies,
  options: KubernetesSystemUpdateCommandOptions,
  version: string,
): Promise<void> {
  if (options.values === undefined) {
    throw new Error('--values is required for an existing Kubernetes installation.');
  }
  const valuesPath: string = options.values;
  const result: KubernetesSystemUpdateResponse = await withResolvedKubernetesOperatorTarget(
    resolveKubernetesOperatorTarget(options),
    async (target: KubernetesOperatorTarget): Promise<KubernetesSystemUpdateResponse> =>
      await updateKubernetesSystem({ ...target, valuesPath, version }),
  );
  renderOutput(
    dependencies.io,
    options.output,
    result,
    createKubernetesSystemUpdateMessage(result, readCliVersion(), createStatusMessage(result.status)),
  );
}

function registerDiagnoseCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('diagnose')
    .description('Create a redacted managed-VM support bundle')
    .option('--path <path>', 'Support bundle output path')
    .option('--output <format>', 'text or json', 'text')
    .action(async (options: ManagedVmDiagnoseCommandOptions): Promise<void> => {
      const result: ManagedVmDiagnoseResult = await createManagedVmDiagnosis(options.path);
      renderOutput(dependencies.io, options.output, result, `Diagnostic bundle: ${result.bundlePath}`);
    });
}

function registerResetCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('reset')
    .description('Destroy a Compartment-provisioned cluster and its owned host state')
    .option('--destroy-provisioned-cluster', 'Acknowledge that platform and application data will be lost')
    .option('--confirm-installation <id>', 'Exact managed installation ID')
    .option('--output <format>', 'text or json', 'text')
    .action(async (options: ManagedVmResetCommandOptions): Promise<void> => {
      if (options.destroyProvisionedCluster !== true || options.confirmInstallation === undefined) {
        throw new Error('Reset requires --destroy-provisioned-cluster and --confirm-installation <installation-id>.');
      }
      await resetManagedVmInstallation({ confirmation: options.confirmInstallation });
      renderOutput(
        dependencies.io,
        options.output,
        { reset: true },
        'Provisioned cluster and owned host state removed.',
      );
    });
}

function createManagedHostStatusMessage(host: ManagedVmSystemStatus): string {
  return `Host provisioner: ${host.provisionerStage}.
Installation ID: ${host.installationId}.
k3s: ${host.k3sActive ? 'active' : 'not active'} (${host.k3sVersion}).`;
}

function createRestartMessage(result: KubernetesSystemRestartResponse): string {
  return `Platform restart ${result.restarted ? 'completed' : 'finished without full readiness'}.\n${createStatusMessage(result.status)}`;
}

function createStatusMessage(result: KubernetesSystemStatusResponse): string {
  const workloadLines: string[] = result.workloads.map(createWorkloadMessage);
  return renderStatusLines([
    `Helm release ${result.releaseName}: ${result.releaseStatus}.`,
    `Platform readiness: ${result.ready ? 'ready' : 'not ready'}.`,
    ...workloadLines,
  ]);
}

function createWorkloadMessage(workload: KubernetesPlatformWorkloadStatus): string {
  return `${workload.kind}/${workload.name}: ${workload.readyReplicas.toString()}/${workload.desiredReplicas.toString()} ready`;
}

function renderStatusLines(lines: readonly string[]): string {
  return lines.join('\n');
}
