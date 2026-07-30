import type { JsonValue } from '@compartment/utils';
import { parse } from 'yaml';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import {
  buildHelmCommand,
  formatKubernetesCommandExecutionFailure,
  readCommandOutput,
} from './kubernetes-command.support';

export async function readKubernetesChartValues(chartPath: string): Promise<JsonValue> {
  const result: CommandResult = await runCommandWithTimeout(
    buildHelmCommand({}, ['show', 'values', chartPath]),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw createChartValuesError(chartPath, result);
  }
  return parse(result.stdout) as JsonValue;
}

function createChartValuesError(chartPath: string, result: CommandResult): Error {
  const prefix: string = `Failed to read Helm chart values from "${chartPath}".`;
  const executionFailure: string | undefined = formatKubernetesCommandExecutionFailure(prefix, result);
  if (executionFailure !== undefined) {
    return new Error(executionFailure);
  }
  const output: string = readCommandOutput(result);
  return new Error(
    output === '' ? `${prefix} Helm exited with status ${result.exitCode.toString()}.` : `${prefix}\n${output}`,
  );
}
