import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';

export async function readPendingKubernetesDomainTlsSecretName(
  target: KubernetesOperatorTarget,
): Promise<string | undefined> {
  const result: CommandResult = await runCommand(buildHelmGetValuesCommand(target));
  if (result.exitCode !== 0) {
    throw new Error(`Failed to inspect the current Helm domain values: ${readCommandFailure(result)}`);
  }
  return parsePendingTlsSecretName(result.stdout);
}

function buildHelmGetValuesCommand(target: KubernetesOperatorTarget): string[] {
  return [
    'helm',
    'get',
    'values',
    target.releaseName,
    '--namespace',
    target.namespace,
    '--output',
    'json',
    ...(target.kubeContext === undefined ? [] : ['--kube-context', target.kubeContext]),
  ];
}

function parsePendingTlsSecretName(output: string): string | undefined {
  const value: JsonValue = parseJson(output);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Helm returned invalid current domain values.');
  }
  const customTls: JsonValue | undefined = value.customTls;
  if (typeof customTls !== 'object' || customTls === null || Array.isArray(customTls)) {
    return undefined;
  }
  const pendingSecretName: JsonValue | undefined = customTls.pendingSecretName;
  return typeof pendingSecretName === 'string' && pendingSecretName !== '' ? pendingSecretName : undefined;
}

function parseJson(output: string): JsonValue {
  try {
    return JSON.parse(output) as JsonValue;
  } catch {
    throw new Error('Invalid JSON returned by current Helm domain values.');
  }
}

function readCommandFailure(result: CommandResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n');
}
