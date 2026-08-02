import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type { JsonValue } from '@compartment/utils';
import { formatKubernetesCommandExecutionFailure, readCommandDiagnostics } from './kubernetes-command.support';

const kubernetesInspectionTimeoutMs: number = 30_000;

export function isHelmJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function runHelmInspection(
  command: readonly string[],
  operation: string,
  includeStdoutInDiagnostics: boolean,
): Promise<CommandResult> {
  const result: CommandResult = await runCommandWithTimeout(command, kubernetesInspectionTimeoutMs);
  if (result.exitCode === 0) {
    return result;
  }
  return throwHelmInspectionFailure(result, operation, includeStdoutInDiagnostics);
}

function throwHelmInspectionFailure(
  result: CommandResult,
  operation: string,
  includeStdoutInDiagnostics: boolean,
): never {
  const executionFailure: string | undefined = formatKubernetesCommandExecutionFailure(
    `Helm ${operation} failed`,
    result,
  );
  if (executionFailure !== undefined) {
    throw new Error(executionFailure);
  }
  const output: string = readCommandDiagnostics(result, { includeStdout: includeStdoutInDiagnostics });
  if (result.exitCode === 124) {
    throw new Error(
      `Timed out after 30s during Helm ${operation}. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.${output === '' ? '' : `\n${output}`}`,
    );
  }
  throw new Error(
    `Helm ${operation} failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}`,
  );
}
