import {
  formatDeploymentRunLogLineText,
  readDeploymentRunTriggerRepositoryLabel,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
  type DeploymentRunTriggerSummary,
} from '@compartment/contracts';

interface DeploymentRunLogsFormatOptions {
  showSelectionNotice?: boolean | undefined;
  verbose?: boolean | undefined;
}

export function createDeploymentRunLogsResultMessage(
  response: DeploymentRunLogsResponse,
  options: DeploymentRunLogsFormatOptions = {},
): string {
  const lines: string = response.lines.map(formatDeploymentRunLogLineText).join('\n');
  const notice: string | null = options.showSelectionNotice === false ? null : buildFailedRunNotice(response);
  if (options.verbose !== true) {
    return joinRunLogsOutput(notice, lines);
  }

  const details: string = buildDeploymentRunLogDetails(response).join('\n');
  return joinRunLogsOutput(notice, lines === '' ? details : `${details}\n\n${lines}`);
}

function buildFailedRunNotice(response: DeploymentRunLogsResponse): string | null {
  return response.deployment.status === 'failed'
    ? `Showing logs of failed deployment run ${response.deployment.id} from ${response.deployment.createdAt}.`
    : null;
}

function joinRunLogsOutput(notice: string | null, output: string): string {
  if (notice === null) {
    return output;
  }
  return output === '' ? notice : `${notice}\n${output}`;
}

function buildDeploymentRunLogDetails(response: DeploymentRunLogsResponse): string[] {
  return [
    `Project: ${response.project.name}`,
    `Environment: ${response.environment.name}`,
    `Run: ${response.deployment.id}`,
    `Label: ${response.deployment.label ?? 'n/a'}`,
    `Status: ${response.deployment.status}`,
    `Trigger: ${formatTrigger(response)}`,
    `Created At: ${response.deployment.createdAt}`,
    `Completed At: ${response.deployment.completedAt ?? 'n/a'}`,
    `Failure: ${response.deployment.failureMessage ?? 'n/a'}`,
    ...buildStepLines(response.steps),
  ];
}

function formatTrigger(response: DeploymentRunLogsResponse): string {
  const trigger: DeploymentRunTriggerSummary = response.deployment.trigger;
  const repository: string | null = readDeploymentRunTriggerRepositoryLabel(trigger);
  const parts: string[] = [trigger.type];
  if (repository !== null) {
    parts.push(repository);
  }
  if (trigger.branchName !== null) {
    parts.push(trigger.branchName);
  }
  if (trigger.commitSha !== null) {
    parts.push(trigger.commitSha);
  }

  return parts.join(' ');
}

function buildStepLines(steps: DeploymentRunStepSummary[]): string[] {
  if (steps.length === 0) {
    return ['Steps: n/a'];
  }

  return ['Steps:', ...steps.map((step: DeploymentRunStepSummary): string => formatStepLine(step))];
}

function formatStepLine(step: DeploymentRunStepSummary): string {
  const servicePrefix: string = step.serviceName === null ? '' : `[${step.serviceName}] `;
  const completedAt: string = step.completedAt === null ? '' : ` -> ${step.completedAt}`;
  return `${servicePrefix}${step.stepKey} ${step.status} ${step.createdAt}${completedAt} ${step.message}`;
}
