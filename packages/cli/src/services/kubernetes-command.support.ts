import type { CommandResult } from '../command-runner.types';
import { formatMissingKubernetesInstallTool } from './kubernetes-install-local-tools.service';

interface HelmCommandTarget {
  kubeconfigPath?: string | undefined;
  kubeContext?: string | undefined;
}

interface KubernetesCommandTarget extends HelmCommandTarget {
  namespace: string;
}

export interface CommandDiagnosticsOptions {
  includeStdout: boolean;
}

export function buildHelmGetValuesCommand(
  target: KubernetesCommandTarget,
  releaseName: string,
  args: readonly string[],
): string[] {
  return buildHelmCommand(target, ['get', 'values', releaseName, '--namespace', target.namespace, ...args]);
}

/**
 * Helm's `--reuse-values` replays the previous release's *coalesced* values, which include the chart
 * defaults that release was rendered from. Every default the chart has changed since then is
 * therefore dropped on upgrade, silently and for any value: raised build memory limits were only the
 * first one to fail loudly. `--reset-then-reuse-values` starts from the bundled chart's current
 * defaults and replays the operator-supplied values Helm recorded on the release, so an upgrade
 * adopts changed defaults while an operator-set value still wins. Helm never folds coalesced defaults
 * back into that recorded set, so a release upgraded under `--reuse-values` adopts the current
 * defaults on its next upgrade without any repair step.
 *
 * This flag belongs here rather than in each caller: every upgrade of an existing release is built
 * through this function, so no future upgrade path can forget it. The install path deliberately does
 * not use this builder; it runs `upgrade --install` and re-supplies its full values set instead.
 */
const helmExistingReleaseValuesFlag: string = '--reset-then-reuse-values';

export function buildHelmUpgradeCommand(
  target: KubernetesCommandTarget,
  releaseName: string,
  chartPath: string,
  args: readonly string[],
): string[] {
  return buildHelmCommand(target, [
    'upgrade',
    releaseName,
    chartPath,
    '--namespace',
    target.namespace,
    helmExistingReleaseValuesFlag,
    ...args,
  ]);
}

export function buildHelmCommand(target: HelmCommandTarget, args: readonly string[]): string[] {
  return ['helm', ...args, ...buildHelmKubeContextArgs(target)];
}

function buildHelmKubeContextArgs(target: HelmCommandTarget): string[] {
  return [
    ...(target.kubeconfigPath === undefined ? [] : ['--kubeconfig', target.kubeconfigPath]),
    ...(target.kubeContext === undefined ? [] : ['--kube-context', target.kubeContext]),
  ];
}

export function buildKubectlCommand(target: KubernetesCommandTarget, args: readonly string[]): string[] {
  return [
    'kubectl',
    ...(target.kubeconfigPath === undefined ? [] : ['--kubeconfig', target.kubeconfigPath]),
    ...(target.kubeContext === undefined ? [] : ['--context', target.kubeContext]),
    '--namespace',
    target.namespace,
    ...args,
  ];
}

export function buildKubernetesReleaseSelector(releaseName: string): string {
  return `app.kubernetes.io/instance=${releaseName}`;
}

export function formatKubernetesCommandFailure(
  message: string,
  result: CommandResult,
  options: CommandDiagnosticsOptions = { includeStdout: true },
): string {
  const executionFailure: string | undefined = formatKubernetesCommandExecutionFailure(message, result);
  if (executionFailure !== undefined) {
    return executionFailure;
  }
  const output: string = readCommandDiagnostics(result, options);
  const status: string =
    result.exitCode === 124 ? 'command timed out' : `command exited with status ${result.exitCode.toString()}`;
  return `${message} (${status}): ${output === '' ? 'the command produced no diagnostics' : output}`;
}

export function formatKubernetesCommandExecutionFailure(message: string, result: CommandResult): string | undefined {
  const executionFailure: string | undefined = readKubernetesCommandExecutionFailure(result);
  return executionFailure === undefined ? undefined : `${message}: ${executionFailure}`;
}

export function readCommandOutput(result: CommandResult): string {
  return readCommandDiagnostics(result, { includeStdout: true });
}

export function readCommandDiagnostics(result: CommandResult, options: CommandDiagnosticsOptions): string {
  const executionFailure: string | undefined = readKubernetesCommandExecutionFailure(result);
  if (executionFailure !== undefined) {
    return executionFailure;
  }
  return [result.stderr.trim(), ...(options.includeStdout ? [result.stdout.trim()] : [])]
    .filter((value: string): boolean => value !== '')
    .join('\n');
}

function readKubernetesCommandExecutionFailure(result: CommandResult): string | undefined {
  return result.failure?.kind === 'command-not-found'
    ? formatMissingKubernetesInstallTool(result.failure.command)
    : undefined;
}
