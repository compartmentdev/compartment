import { parseJsonWith, type JsonValue } from '@compartment/utils';
import { z } from 'zod';
import type { CommandResult } from '../command-runner.types';
import { buildHelmCommand, formatKubernetesShellCommand } from './kubernetes-command.support';
import { isHelmJsonObject, parseHelmRevision, runHelmInspection } from './kubernetes-helm-inspection.service';
import type {
  HelmReleaseHistoryEntry,
  HelmReleaseSummary,
  KubernetesInstallDeploymentInput,
} from './kubernetes-install.service.types';

const helmReleaseHistorySchema: z.ZodType<JsonValue[]> = z.array(z.custom<JsonValue>());

export async function requireDeployedHelmRelease(
  input: KubernetesInstallDeploymentInput,
  release: HelmReleaseSummary,
): Promise<void> {
  if (release.status === 'deployed') {
    return;
  }
  const recoveryRevision: number | null = await readLatestSuccessfulRevision(input, release.revision);
  const recoveryGuidance: string = buildRecoveryGuidance(input, recoveryRevision);
  throw new Error(`The existing Helm release ${release.name} has status ${release.status}. ${recoveryGuidance}`);
}

async function readLatestSuccessfulRevision(
  input: KubernetesInstallDeploymentInput,
  failedRevision: number,
): Promise<number | null> {
  const result: CommandResult = await runHelmInspection(buildHelmHistoryCommand(input), 'release history lookup', true);
  const entries: HelmReleaseHistoryEntry[] = parseJsonWith(helmReleaseHistorySchema, result.stdout).flatMap(
    parseHistoryEntry,
  );
  return (
    entries
      .filter(
        (entry: HelmReleaseHistoryEntry): boolean =>
          entry.revision < failedRevision && ['deployed', 'superseded'].includes(entry.status),
      )
      .sort(
        (left: HelmReleaseHistoryEntry, right: HelmReleaseHistoryEntry): number => right.revision - left.revision,
      )[0]?.revision ?? null
  );
}

function parseHistoryEntry(candidate: JsonValue): HelmReleaseHistoryEntry[] {
  if (!isHelmJsonObject(candidate) || typeof candidate.status !== 'string') {
    return [];
  }
  const revision: number | null = parseHelmRevision(candidate.revision);
  return revision === null ? [] : [{ revision, status: candidate.status }];
}

function buildRecoveryGuidance(input: KubernetesInstallDeploymentInput, revision: number | null): string {
  if (revision === null) {
    return `Inspect the release with \`${formatKubernetesShellCommand(buildHelmHistoryCommand(input))}\` or uninstall it before retrying compartment install.`;
  }
  return `Restore it with \`${formatKubernetesShellCommand(buildHelmRollbackCommand(input, revision))}\`, then retry compartment install.`;
}

function buildHelmHistoryCommand(input: KubernetesInstallDeploymentInput): string[] {
  return buildHelmCommand(input, ['history', input.releaseName, '--namespace', input.namespace, '--output', 'json']);
}

function buildHelmRollbackCommand(input: KubernetesInstallDeploymentInput, revision: number): string[] {
  return buildHelmCommand(input, [
    'rollback',
    input.releaseName,
    revision.toString(),
    '--namespace',
    input.namespace,
    '--wait',
    '--timeout',
    '8m',
    '--force-conflicts',
  ]);
}
