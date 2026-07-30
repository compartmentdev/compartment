import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildHelmGetValuesCommand, readCommandDiagnostics } from './kubernetes-command.support';
import type { KubernetesReleaseValuesInput } from './kubernetes-release-values.service.types';

export async function readKubernetesReleaseValues(input: KubernetesReleaseValuesInput): Promise<JsonValue> {
  const result: CommandResult = await runCommand(buildHelmGetReleaseValuesCommand(input));
  if (result.exitCode !== 0) {
    const output: string = readCommandDiagnostics(result, { includeStdout: false });
    throw new Error(
      `Failed to read effective Helm release values before platform image verification.${
        output === '' ? '' : `\n${output}`
      }`,
    );
  }
  try {
    return JSON.parse(result.stdout) as JsonValue;
  } catch {
    throw new Error('Helm returned invalid release values before platform image verification.');
  }
}

function buildHelmGetReleaseValuesCommand(input: KubernetesReleaseValuesInput): string[] {
  return buildHelmGetValuesCommand(input, input.releaseName, ['--all', '--output', 'json']);
}
