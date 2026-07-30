import type { CommandResult } from '../command-runner.types';
import { formatKubernetesCommandFailure, readCommandDiagnostics } from './kubernetes-command.support';

export function createRetainedStateInspectionError(result: CommandResult): Error {
  const diagnostics: string = readSecretCommandDiagnostics(result);
  if (result.exitCode === 124) {
    return new Error(
      `Timed out after 30s inspecting retained Kubernetes install state. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.${diagnostics === '' ? '' : `\n${diagnostics}`}`,
    );
  }
  return new Error(
    formatKubernetesCommandFailure('Failed to inspect retained Kubernetes install state', result, {
      includeStdout: false,
    }),
  );
}

export function isMissingNamespaceFailure(result: CommandResult, namespace: string): boolean {
  const diagnostics: string = readSecretCommandDiagnostics(result);
  return diagnostics.includes('(NotFound)') && diagnostics.includes(`namespaces "${namespace}" not found`);
}

function readSecretCommandDiagnostics(result: CommandResult): string {
  return readCommandDiagnostics(result, { includeStdout: false });
}
