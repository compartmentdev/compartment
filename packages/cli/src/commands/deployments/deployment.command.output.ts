import type {
  DeployResponse,
  DeploymentLogLine,
  DeploymentReadSummary,
  DeploymentLogsResponse,
  PodResourceMetric,
  DeploymentStatusResponse,
  ResourceSummary,
  DeploymentSummary,
} from '@compartment/contracts';
import { appendDeploymentAccessProtectionMessage } from '../../services/deployment-access-output.service';
import { readDisplayedDeployments } from '../../services/deployment-displayed-deployments.service';
import { readDeploymentDurationLabel } from '../../services/deployment-duration.service';
import { buildNoDeploymentsFoundMessage } from '../../services/deployment-empty-message.service';
import { formatDeploymentLabelTag } from '../../services/deployment-label-output.service';
import { buildVerboseDeploymentDetails } from './deployment.command.details';
import { buildDeploymentProgressMessage, createDeploymentProgressSignature } from './deployment.command.progress';
import type {
  DeploymentFormatOptions,
  DeploymentProgressReporterOptions,
  DeploymentProgressState,
  DeploymentStatusReporter,
  DeploymentSummaryParts,
} from './deployment.command.output.types';
import type { DeploymentStatusView } from '../../services/deployments.types';
import {
  appendFailedDeploymentGuidance,
  buildHistoricalLogsNotice,
  joinDeploymentLogsOutput,
  readFailureStageText,
} from '../../services/deployment-failure-output.service';

export function createDeployResultMessage(
  response: DeploymentStatusResponse,
  options: DeploymentFormatOptions = {},
): string {
  const deployments: DeploymentReadSummary[] = readDisplayedDeployments(response);
  if (deployments.length === 0) {
    return buildNoDeploymentsMessage(response);
  }
  const baseMessage: string =
    deployments.length > 1
      ? buildMultiDeploymentDeployMessage(response)
      : buildSingleDeploymentDeployMessage(deployments[0]!, options.now);
  const message: string = appendResourceSummary(appendVerboseDetails(baseMessage, response, options.verbose), response);
  return appendDeploymentAccessProtectionMessage(message, deployments);
}

function buildSingleDeploymentDeployMessage(deployment: DeploymentReadSummary, now: number | undefined): string {
  const summary: DeploymentSummaryParts = buildDeploymentSummaryParts(deployment, now);
  const durationText: string = readDeployDurationText(summary.durationLabel);
  const labelText: string = formatDeploymentLabelTag(deployment.label);
  return deployment.routeUrl !== null
    ? `Deployment ${deployment.id}${labelText} is active at ${deployment.routeUrl}${durationText}.`
    : `Deployment ${deployment.id}${labelText} is ${deployment.status}${durationText}.`;
}

export function createDeployDetachMessage(response: DeployResponse): string {
  const serviceDeploymentIds: string = response.deployments
    .map((deployment: DeploymentSummary): string => `${deployment.serviceName}=${deployment.id}`)
    .join(', ');
  const followUpCommand: string = createDeploymentLogsFollowUpCommand(response);

  return `Deployment queued for ${response.project.name}/${response.environment.name}. Run: ${response.deploymentRunId}. Service deployments: ${serviceDeploymentIds}. Follow progress with ${followUpCommand}.`;
}

export function createStatusResultMessage(
  response: DeploymentStatusView,
  options: DeploymentFormatOptions = {},
): string {
  const deployments: DeploymentReadSummary[] = readDisplayedDeployments(response);
  if (deployments.length === 0) {
    return buildNoDeploymentsMessage(response);
  }
  const baseMessage: string = buildStatusBaseMessage(response, deployments, options.now);
  return appendPodMetrics(
    appendVerboseDetails(appendFailedDeploymentGuidance(baseMessage, deployments), response, options.verbose),
    response,
  );
}

function buildStatusBaseMessage(
  response: DeploymentStatusResponse,
  deployments: DeploymentReadSummary[],
  now: number | undefined,
): string {
  if (deployments.length > 1) {
    return buildMultiDeploymentStatusMessage(response, now);
  }
  const deployment: DeploymentReadSummary = deployments[0]!;
  const summary: DeploymentSummaryParts = buildDeploymentSummaryParts(deployment, now);
  const durationText: string = readStatusDurationText(summary.durationLabel, deployment);
  const failureStage: string = readFailureStageText(deployment);
  return `Deployment ${deployment.id}${formatDeploymentLabelTag(deployment.label)} is ${deployment.status}${failureStage}${durationText}.${buildStatusRouteText(
    response,
    deployment,
  )}`;
}

function appendPodMetrics(baseMessage: string, response: DeploymentStatusView): string {
  if (response.metrics.state === 'unavailable') {
    return `${baseMessage}\nPod metrics: unavailable.`;
  }
  const freshness: string = response.metrics.state === 'stale' ? ' (stale)' : '';
  if (response.metrics.pods.length === 0) {
    return `${baseMessage}\nPod metrics${freshness}: no product Pod samples.`;
  }
  const lines: string = response.metrics.pods
    .map(
      (pod: PodResourceMetric): string =>
        `${pod.serviceName}/${pod.podName}: ${pod.cpuMillicores.toFixed(3)}m CPU, ${formatMemoryMiB(pod.memoryBytes)} MiB RAM`,
    )
    .join('\n');
  return `${baseMessage}\nPod metrics${freshness}:\n${lines}`;
}

function formatMemoryMiB(memoryBytes: number): string {
  return (memoryBytes / 1_048_576).toFixed(2);
}

export function createLogsResultMessage(
  response: DeploymentLogsResponse,
  options: DeploymentFormatOptions = {},
): string {
  const includeServicePrefix: boolean = shouldPrefixLogServiceName(response);
  const lines: string = response.lines
    .map((line: DeploymentLogLine): string => formatDeploymentLogLine(line, includeServicePrefix))
    .join('\n');
  const selectionNotice: string | null =
    options.showSelectionNotice === false ? null : buildHistoricalLogsNotice(response);
  if (options.verbose !== true) {
    return joinDeploymentLogsOutput(selectionNotice ?? '', lines);
  }

  const verboseDetails: string = buildVerboseDetails(response);
  const details: string = selectionNotice === null ? verboseDetails : `${selectionNotice}\n${verboseDetails}`;
  return joinDeploymentLogsOutput(details, lines);
}

export function createDeploymentProgressReporter(options: DeploymentProgressReporterOptions): DeploymentStatusReporter {
  const state: DeploymentProgressState = { lastSignature: null };
  const nowProvider: () => number = options.now ?? ((): number => Date.now());

  return (status: DeploymentStatusResponse): void => {
    const deployments: DeploymentReadSummary[] = readDisplayedDeployments(status);
    if (deployments.length === 0) {
      return;
    }

    const now: number = nowProvider();
    const signature: string = createDeploymentProgressSignature(
      deployments,
      options.progress.mode === 'live' ? now : null,
    );
    if (signature === state.lastSignature) {
      return;
    }

    state.lastSignature = signature;
    options.progress.report(buildDeploymentProgressMessage(status, deployments, now));
  };
}

function appendVerboseDetails(
  baseMessage: string,
  response: DeploymentStatusResponse,
  verbose: boolean | undefined,
): string {
  if (verbose !== true) {
    return baseMessage;
  }

  return `${baseMessage}\n${buildVerboseDetails(response)}`;
}

function buildNoDeploymentsMessage(response: DeploymentStatusResponse): string {
  return buildNoDeploymentsFoundMessage(response.project.name, response.environment.name);
}

function buildDeploymentSummaryParts(
  deployment: DeploymentReadSummary,
  now: number | undefined,
): DeploymentSummaryParts {
  return { durationLabel: readDeploymentDurationLabel(deployment, now ?? Date.now()) };
}

function buildMultiDeploymentDeployMessage(response: DeploymentStatusResponse): string {
  const parts: string[] = response.deployments.map((deployment: DeploymentReadSummary): string =>
    deployment.routeUrl !== null
      ? `${deployment.serviceName}${formatDeploymentLabelTag(deployment.label)} active at ${deployment.routeUrl}`
      : `${deployment.serviceName}${formatDeploymentLabelTag(deployment.label)} is ${deployment.status}`,
  );

  return `Deployments for ${response.project.name}/${response.environment.name}: ${parts.join('; ')}.`;
}

function buildMultiDeploymentStatusMessage(response: DeploymentStatusResponse, now: number | undefined): string {
  const parts: string[] = response.deployments.map((deployment: DeploymentReadSummary): string =>
    formatMultiDeploymentStatusPart(deployment, now),
  );

  return `Deployments for ${response.project.name}/${response.environment.name}: ${parts.join('; ')}.`;
}

function formatMultiDeploymentStatusPart(deployment: DeploymentReadSummary, now: number | undefined): string {
  const durationLabel: string | null = readDeploymentDurationLabel(deployment, now ?? Date.now());
  const durationText: string = readStatusDurationText(durationLabel, deployment);

  return `${deployment.serviceName}${formatDeploymentLabelTag(deployment.label)}=${deployment.status}${readFailureStageText(deployment)}${durationText}`;
}

function buildStatusRouteText(response: DeploymentStatusResponse, deployment: DeploymentReadSummary): string {
  const activeDeployment: DeploymentReadSummary | null = readSingleActiveDeployment(response);
  if (deployment.routeUrl === null) {
    return '';
  }
  if (activeDeployment?.id === deployment.id) {
    return ` Active route: ${deployment.routeUrl}.`;
  }

  return activeDeployment === null
    ? ` Recorded route: ${deployment.routeUrl}. No active deployment.`
    : ` Recorded route: ${deployment.routeUrl}. Active deployment: ${activeDeployment.id}.`;
}

function readDeployDurationText(durationLabel: string | null): string {
  return durationLabel === null ? '' : ` in ${durationLabel}`;
}

function readStatusDurationText(durationLabel: string | null, deployment: DeploymentReadSummary): string {
  if (durationLabel === null) {
    return '';
  }

  return deployment.completedAt !== null ? ` in ${durationLabel}` : ` for ${durationLabel}`;
}

function formatDeploymentLogLine(line: DeploymentLogLine, includeServicePrefix: boolean): string {
  const servicePrefix: string = includeServicePrefix ? `[${line.serviceName}] ` : '';

  return `${line.timestamp} ${servicePrefix}${line.stream} ${line.message}`;
}

function shouldPrefixLogServiceName(response: DeploymentLogsResponse): boolean {
  return (
    hasMultipleServiceNames(response.lines.map((line: DeploymentLogLine): string => line.serviceName)) ||
    hasMultipleServiceNames(
      response.deployments.map((deployment: DeploymentReadSummary): string => deployment.serviceName),
    )
  );
}

function hasMultipleServiceNames(serviceNames: string[]): boolean {
  return new Set(serviceNames).size > 1;
}

function buildVerboseDetails(response: DeploymentLogsResponse | DeploymentStatusResponse): string {
  return buildVerboseDeploymentDetails({
    displayedDeployments: 'lines' in response ? response.deployments : readDisplayedDeployments(response),
    environmentName: response.environment.name,
    projectName: response.project.name,
    response,
  });
}

function createDeploymentLogsFollowUpCommand(response: DeployResponse): string {
  return `compartment deployment logs --project ${response.project.name} --env ${response.environment.name} --run ${response.deploymentRunId}`;
}

function readSingleActiveDeployment(response: DeploymentStatusResponse): DeploymentReadSummary | null {
  return response.activeDeployments.length === 1 ? response.activeDeployments[0]! : null;
}

function appendResourceSummary(baseMessage: string, response: DeploymentStatusResponse): string {
  const resources: ResourceSummary[] | undefined = readDeployResources(response);
  if (resources === undefined || resources.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}\n${resources
    .map((resource: ResourceSummary): string => `Resource ${resource.name} is ${resource.status}.`)
    .join('\n')}`;
}

function readDeployResources(response: DeploymentStatusResponse): ResourceSummary[] | undefined {
  return 'resources' in response && Array.isArray(response.resources)
    ? (response.resources as ResourceSummary[])
    : undefined;
}
