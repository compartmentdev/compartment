import type {
  KubernetesSystemRestartResponse,
  KubernetesSystemStatusResponse,
  KubernetesSystemUpdateResponse,
  KubernetesPlatformWorkloadStatus,
} from '@compartment/contracts';
import type { Command } from 'commander';
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
  addKubernetesSystemUpdateOptions,
  resolveKubernetesOperatorTarget,
  resolveKubernetesSystemUpdateVersion,
} from './system.command.options';
import type { KubernetesOperatorCommandOptions, KubernetesSystemUpdateCommandOptions } from './system.command.types';

export function registerKubernetesSystemLifecycleCommands(
  program: Command,
  dependencies: CliCommandDependencies,
): void {
  registerStatusCommand(program, dependencies);
  registerRestartCommand(program, dependencies);
  registerUpdateCommand(program, dependencies);
}

function registerStatusCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorTargetOptions(
    program.command('status').description('Show Helm release status and platform workload readiness'),
  ).action(async (options: KubernetesOperatorCommandOptions): Promise<void> => {
    const result: KubernetesSystemStatusResponse = await withResolvedKubernetesOperatorTarget(
      resolveKubernetesOperatorTarget(options),
      getKubernetesSystemStatus,
    );
    renderOutput(dependencies.io, options.output, result, createStatusMessage(result));
  });
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
  addKubernetesSystemUpdateOptions(
    program
      .command('update')
      .description('Verify and update the Kubernetes platform images')
      .option('--version <version>', 'Platform image tag; defaults to the packaged CLI release'),
  ).action(async (options: KubernetesSystemUpdateCommandOptions): Promise<void> => {
    const version: string = resolveKubernetesSystemUpdateVersion(options.version);
    const result: KubernetesSystemUpdateResponse = await withResolvedKubernetesOperatorTarget(
      resolveKubernetesOperatorTarget(options),
      async (target: KubernetesOperatorTarget): Promise<KubernetesSystemUpdateResponse> =>
        await updateKubernetesSystem({
          ...target,
          valuesPath: options.values,
          version,
        }),
    );
    renderOutput(dependencies.io, options.output, result, createUpdateMessage(result));
  });
}

function createRestartMessage(result: KubernetesSystemRestartResponse): string {
  return `Platform restart ${result.restarted ? 'completed' : 'finished without full readiness'}.\n${createStatusMessage(result.status)}`;
}

function createUpdateMessage(result: KubernetesSystemUpdateResponse): string {
  return `Platform update to ${result.version} ${result.updated ? 'completed' : 'finished without full readiness'}.\n${createStatusMessage(result.status)}`;
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
