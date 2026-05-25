import {
  buildDeploymentReadRunGroups,
  type DeploymentListResponse,
  type DeploymentReadRunGroup,
  type DeploymentReadSummary,
} from '@compartment/contracts';
import { buildNoDeploymentsFoundMessage } from './deployment-empty-message.service';
import { formatFixedWidthColumn } from './fixed-width-column-output.service';

const statusColumnWidth: number = 9;
const runLabelColumnWidth: number = 24;
const runServiceCountColumnWidth: number = 12;
const stageColumnWidth: number = 18;
const activityColumnWidth: number = 8;
const serviceColumnWidth: number = 20;
const labelColumnWidth: number = 24;
const failureSummaryMaxLength: number = 80;

export function createDeploymentListMessage(response: DeploymentListResponse, environmentName: string): string {
  if (response.deployments.length === 0) {
    return buildNoDeploymentsFoundMessage(response.project.name, environmentName);
  }

  const includeLabelColumn: boolean = response.deployments.some(
    (deployment: DeploymentReadSummary): boolean => deployment.label !== null,
  );
  const runGroups: DeploymentReadRunGroup[] = buildDeploymentReadRunGroups(response.deployments);

  return runGroups
    .map((runGroup: DeploymentReadRunGroup): string => formatDeploymentRunGroup(runGroup, includeLabelColumn))
    .join('\n\n');
}

function formatDeploymentRunGroup(runGroup: DeploymentReadRunGroup, includeLabelColumn: boolean): string {
  const lines: string[] = [
    formatDeploymentRunHeader(runGroup),
    ...runGroup.deployments.map(
      (deployment: DeploymentReadSummary): string => `  ${formatDeploymentRow(deployment, includeLabelColumn)}`,
    ),
  ];

  return joinDeploymentRunGroupLines(lines);
}

function formatDeploymentRunHeader(runGroup: DeploymentReadRunGroup): string {
  const columns: string[] = [
    `run ${runGroup.deploymentRunId}`,
    formatFixedWidthColumn(runGroup.label, runLabelColumnWidth),
    runGroup.status.padEnd(statusColumnWidth, ' '),
    formatFixedWidthColumn(readRunServiceCountLabel(runGroup.deploymentCount), runServiceCountColumnWidth),
    runGroup.createdAt,
  ];

  return columns.join('  ');
}

function formatDeploymentRow(deployment: DeploymentReadSummary, includeLabelColumn: boolean): string {
  const columns: string[] = [
    deployment.id,
    formatServiceNameColumn(deployment.serviceName),
    deployment.status.padEnd(statusColumnWidth, ' '),
    deployment.promotionStage.padEnd(stageColumnWidth, ' '),
    readActivityLabel(deployment).padEnd(activityColumnWidth, ' '),
    deployment.createdAt,
  ];
  if (includeLabelColumn) {
    columns.splice(2, 0, formatLabelColumn(deployment.label));
  }

  const failureSummary: string = formatFailureSummary(deployment);
  if (failureSummary !== '') {
    columns.push(failureSummary);
  }

  return columns.join('  ');
}

function readRunServiceCountLabel(deploymentCount: number): string {
  return deploymentCount === 1 ? '1 service' : `${deploymentCount} services`;
}

function joinDeploymentRunGroupLines(lines: readonly string[]): string {
  return lines.join('\n');
}

function formatServiceNameColumn(serviceName: string): string {
  return formatFixedWidthColumn(serviceName, serviceColumnWidth);
}

function formatLabelColumn(label: string | null): string {
  return formatFixedWidthColumn(label ?? '', labelColumnWidth);
}

function readActivityLabel(deployment: DeploymentReadSummary): string {
  return deployment.isActive ? 'active' : 'inactive';
}

function formatFailureSummary(deployment: DeploymentReadSummary): string {
  if (deployment.status !== 'failed' || deployment.failureMessage === null) {
    return '';
  }

  const firstLine: string = deployment.failureMessage.split('\n')[0] ?? deployment.failureMessage;
  if (!isSafeFailureSummary(firstLine)) {
    return 'internal error';
  }

  return truncateFailureSummary(firstLine);
}

function truncateFailureSummary(message: string): string {
  if (message.length <= failureSummaryMaxLength) {
    return message;
  }

  return `${message.slice(0, failureSummaryMaxLength - 3)}...`;
}

function isSafeFailureSummary(message: string): boolean {
  return (
    !message.includes('/internal/') &&
    !message.includes('http://') &&
    !message.includes('https://') &&
    !/^\s*\{/.test(message) &&
    !/^\s*\[(?:\{|"|\d)/.test(message) &&
    !/\/(?:Users|app|bin|dev|etc|home|lib|mnt|opt|private|proc|root|run|srv|sys|tmp|usr|var|workspace)\//.test(
      message,
    ) &&
    !/\b[A-Za-z]:\\\S+/.test(message)
  );
}
