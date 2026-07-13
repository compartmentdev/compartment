import {
  compartmentDeploymentRunLogsPathname,
  compartmentDeploymentsPathname,
  compartmentDeploymentMetricsPathname,
  type DeploymentMetricsSnapshot,
  type DeploymentReadSummary,
  type PodResourceMetric,
  type DeploymentRunLogsQuery,
  type DeploymentRunLogsResponse,
} from '@compartment/contracts/browser';
import { appendOptionalSearchParam } from '@compartment/utils';
import type { BrowserDeploymentDetailsPageResult } from '../../services/browser-deployment-history.service.types';
import type { BrowserConsoleContext } from '../console/console-data';
import { buildDeploymentHistoryHref, buildDeploymentHistoryUnavailableHref } from './deployment-history-query';
import type { DeploymentHistoryLocationQuery } from './deployment-history-loader.shared';

interface BuildDeploymentDetailsPageResultInput {
  consoleContext: BrowserConsoleContext;
  deploymentRunId: string;
  projectName: string;
  query: DeploymentHistoryLocationQuery;
  runLogs: DeploymentRunLogsResponse;
  metrics: DeploymentMetricsSnapshot;
  selectedOrganizationSlug: string;
}

type DeploymentDetailsPageChrome = Pick<
  BrowserDeploymentDetailsPageResult,
  | 'backHref'
  | 'currentOrganizationPermissions'
  | 'deploymentRunId'
  | 'organizationContext'
  | 'organizations'
  | 'principalEmail'
  | 'selectedOrganizationSlug'
  | 'showOrganizationSelector'
>;

interface DeploymentHistoryHrefInput {
  environmentName: string | null;
  organizationSlug: string | null;
  projectName: string;
}

interface DeploymentListPathInput {
  environmentName: string;
  limit: number;
  projectName: string;
}

type DeploymentRunLogsByIdQuery = Extract<DeploymentRunLogsQuery, { selector: 'run' }>;

export function buildDeploymentListPath(query: DeploymentListPathInput): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  appendOptionalSearchParam(searchParams, 'environmentName', query.environmentName);
  appendOptionalSearchParam(searchParams, 'limit', String(query.limit));
  appendOptionalSearchParam(searchParams, 'projectName', query.projectName);
  return `${compartmentDeploymentsPathname}?${searchParams.toString()}`;
}

export function buildDeploymentRunLogsPath(projectName: string, deploymentRunId: string): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  const runLogsQuery: DeploymentRunLogsByIdQuery = buildDeploymentRunLogsQuery(projectName, deploymentRunId);
  appendOptionalSearchParam(searchParams, 'projectName', runLogsQuery.projectName);
  appendOptionalSearchParam(searchParams, 'selector', runLogsQuery.selector);
  appendOptionalSearchParam(searchParams, 'deploymentRunId', runLogsQuery.deploymentRunId);
  appendOptionalSearchParam(searchParams, 'serviceName', runLogsQuery.serviceName);
  appendOptionalSearchParam(searchParams, 'since', runLogsQuery.since);
  appendOptionalSearchParam(
    searchParams,
    'tailLines',
    runLogsQuery.tailLines === undefined ? undefined : String(runLogsQuery.tailLines),
  );
  return `${compartmentDeploymentRunLogsPathname}?${searchParams.toString()}`;
}

export function buildDeploymentMetricsStatusPath(projectName: string, environmentName: string): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  appendOptionalSearchParam(searchParams, 'projectName', projectName);
  appendOptionalSearchParam(searchParams, 'environmentName', environmentName);
  return `${compartmentDeploymentMetricsPathname}?${searchParams.toString()}`;
}

export function buildDeploymentDetailsPageResult(
  input: BuildDeploymentDetailsPageResultInput,
): BrowserDeploymentDetailsPageResult {
  const historyEnvironmentName: string = readHistoryEnvironmentName(input.query, input.runLogs);
  const chrome: DeploymentDetailsPageChrome = buildDeploymentDetailsPageChrome(input, historyEnvironmentName);

  return {
    ...chrome,
    deployment: input.runLogs.deployment,
    deployments: input.runLogs.deployments,
    environmentName: input.runLogs.environment.name,
    lines: input.runLogs.lines,
    metrics: filterRunMetrics(input.metrics, input.runLogs),
    projectName: input.runLogs.project.name,
    steps: input.runLogs.steps,
  };
}

function filterRunMetrics(
  metrics: DeploymentMetricsSnapshot,
  runLogs: DeploymentRunLogsResponse,
): DeploymentMetricsSnapshot {
  const deploymentIds: Set<string> = new Set<string>(
    runLogs.deployments.map((deployment: DeploymentReadSummary): string => deployment.id),
  );
  return {
    ...metrics,
    pods: metrics.pods.filter((pod: PodResourceMetric): boolean => deploymentIds.has(pod.deploymentId)),
  };
}

export function buildDeploymentDetailsRefreshContext(
  currentData: BrowserDeploymentDetailsPageResult,
): BrowserConsoleContext {
  return {
    currentOrganizationPermissions: currentData.currentOrganizationPermissions,
    organizationContext: currentData.organizationContext,
    organizations: currentData.organizations,
    principalEmail: currentData.principalEmail,
    selectedOrganizationSlug: currentData.selectedOrganizationSlug,
    showOrganizationSelector: currentData.showOrganizationSelector,
  };
}

export function buildDeploymentDetailsUnavailableHref(
  projectName: string,
  query: DeploymentHistoryLocationQuery,
  organizationSlug: string,
): string {
  return buildDeploymentHistoryUnavailableHref(buildHistoryHrefInput(projectName, query, organizationSlug));
}

function buildDeploymentRunLogsQuery(projectName: string, deploymentRunId: string): DeploymentRunLogsByIdQuery {
  return {
    deploymentRunId,
    projectName,
    selector: 'run',
  };
}

function readHistoryEnvironmentName(query: DeploymentHistoryLocationQuery, runLogs: DeploymentRunLogsResponse): string {
  return query.environmentName ?? runLogs.environment.name;
}

function buildDeploymentDetailsPageChrome(
  input: BuildDeploymentDetailsPageResultInput,
  historyEnvironmentName: string,
): DeploymentDetailsPageChrome {
  return {
    backHref: buildHistoryBackHref(
      input.projectName,
      input.query,
      input.selectedOrganizationSlug,
      historyEnvironmentName,
    ),
    currentOrganizationPermissions: input.consoleContext.currentOrganizationPermissions,
    deploymentRunId: input.deploymentRunId,
    organizationContext: input.consoleContext.organizationContext,
    organizations: input.consoleContext.organizations,
    principalEmail: input.consoleContext.principalEmail,
    selectedOrganizationSlug: input.selectedOrganizationSlug,
    showOrganizationSelector: input.consoleContext.showOrganizationSelector,
  };
}

function buildHistoryBackHref(
  projectName: string,
  query: DeploymentHistoryLocationQuery,
  selectedOrganizationSlug: string,
  historyEnvironmentName: string,
): string {
  return buildDeploymentHistoryHref({
    ...buildHistoryHrefInput(projectName, query, selectedOrganizationSlug),
    environmentName: historyEnvironmentName,
  });
}

export function buildHistoryHrefInput(
  projectName: string,
  query: DeploymentHistoryLocationQuery,
  organizationSlug: string | null,
): DeploymentHistoryHrefInput {
  return {
    environmentName: query.environmentName,
    organizationSlug,
    projectName,
  };
}
