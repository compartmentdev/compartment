import { parseJsonWith, type JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildHelmGetValuesCommand, readCommandOutput } from './kubernetes-command.support';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';

const helmDomainValuesSchema: z.ZodType<Record<string, JsonValue>> = z.record(z.custom<JsonValue>());

export async function readPendingKubernetesDomainTlsSecretName(
  target: KubernetesOperatorTarget,
): Promise<string | undefined> {
  const result: CommandResult = await runCommand(
    buildHelmGetValuesCommand(target, target.releaseName, ['--output', 'json']),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to inspect the current Helm domain values: ${readCommandOutput(result)}`);
  }
  return parsePendingTlsSecretName(result.stdout);
}

function parsePendingTlsSecretName(output: string): string | undefined {
  const value: Record<string, JsonValue> = parseJsonWith(helmDomainValuesSchema, output);
  const customTls: JsonValue | undefined = value.customTls;
  if (typeof customTls !== 'object' || customTls === null || Array.isArray(customTls)) {
    return undefined;
  }
  const pendingSecretName: JsonValue | undefined = customTls.pendingSecretName;
  return typeof pendingSecretName === 'string' && pendingSecretName !== '' ? pendingSecretName : undefined;
}
