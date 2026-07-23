import {
  buildDeploymentReadRunGroups,
  readDeploymentReadRunStatus,
  type DeploymentReadRunGroup,
  type DeploymentReadSummary,
  type DeploymentRunLogLine,
  type DeploymentRunLogsResponse,
  type DeploymentRunSummary,
  type DeploymentRunTriggerSummary,
} from '@compartment/contracts';
import { parseJsonWith, type JsonValue } from '@compartment/utils';
import { z } from 'zod';
import type {
  DeploymentRunEventInput,
  DeploymentRunInput,
  DeploymentRunLogsResponseInput,
  DeploymentSummaryInput,
} from '../../services/presenter.types';
import {
  buildDeploymentReadEnvironmentSummary,
  buildDeploymentReadProjectSummary,
  buildDeploymentReadSummary,
} from './deployment-read.presenter';
import { buildDeploymentRunLogLine, buildDeploymentRunSteps } from './deployment-run-steps.presenter';

type ParsedJsonRecord = Record<string, JsonValue>;
const parsedJsonRecordSchema: z.ZodType<ParsedJsonRecord> = z.record(z.custom<JsonValue>());

export function buildDeploymentRunLogsResponse(result: DeploymentRunLogsResponseInput): DeploymentRunLogsResponse {
  const deployments: DeploymentReadSummary[] = result.deployments.map(buildDeploymentReadSummary);
  const runDeployments: DeploymentReadSummary[] = result.runDeployments.map(buildDeploymentReadSummary);
  const serviceNameByDeploymentId: Map<string, string> = buildServiceNameByDeploymentId(result.deployments);

  return {
    deployment: buildDeploymentRunSummary(result.run, runDeployments),
    deployments,
    environment: buildDeploymentReadEnvironmentSummary({ name: result.environmentName }),
    lines: result.lineEvents.map(
      (event: DeploymentRunEventInput): DeploymentRunLogLine =>
        buildDeploymentRunLogLine(event, serviceNameByDeploymentId),
    ),
    project: buildDeploymentReadProjectSummary({ name: result.projectName }),
    steps: buildDeploymentRunSteps(result.stepEvents, serviceNameByDeploymentId),
  };
}

function buildServiceNameByDeploymentId(deployments: readonly DeploymentSummaryInput[]): Map<string, string> {
  return new Map(
    deployments.map((deployment: DeploymentSummaryInput): [string, string] => [
      deployment.deployment.id,
      deployment.service.name,
    ]),
  );
}

function buildDeploymentRunSummary(
  run: DeploymentRunInput,
  deployments: DeploymentReadSummary[],
): DeploymentRunSummary {
  const runGroup: DeploymentReadRunGroup | null = buildDeploymentReadRunGroups(deployments)[0] ?? null;

  return {
    completedAt: runGroup?.completedAt ?? null,
    createdAt: run.createdAt.toISOString(),
    failureMessage: runGroup?.failureMessage ?? null,
    id: run.id,
    label: run.label,
    status: runGroup?.status ?? readDeploymentReadRunStatus(deployments),
    trigger: buildDeploymentRunTriggerSummary(run),
  };
}

function buildDeploymentRunTriggerSummary(run: DeploymentRunInput): DeploymentRunTriggerSummary {
  const branchName: string | null = readParsedNullableStringField(run.sourceBindingSnapshotJson, 'branchName');
  const repositoryName: string | null = readParsedNullableStringField(
    run.sourceRepositorySnapshotJson,
    'repositoryName',
  );
  const repositoryOwner: string | null = readParsedNullableStringField(
    run.sourceRepositorySnapshotJson,
    'repositoryOwner',
  );

  return {
    branchName,
    commitSha: run.sourceCommitSha,
    repositoryName,
    repositoryOwner,
    sourceEventId: run.sourceEventId,
    sourceResolutionTaskId: run.sourceResolutionTaskId,
    type: run.triggerType,
  };
}

function readParsedNullableStringField(value: string | null, field: string): string | null {
  const parsed: ParsedJsonRecord | null = parseJsonRecord(value);
  const fieldValue: JsonValue | undefined = parsed?.[field];
  return typeof fieldValue === 'string' ? fieldValue : null;
}

function parseJsonRecord(value: string | null): ParsedJsonRecord | null {
  if (value === null) {
    return null;
  }

  try {
    return parseJsonWith(parsedJsonRecordSchema, value);
  } catch {
    return null;
  }
}
