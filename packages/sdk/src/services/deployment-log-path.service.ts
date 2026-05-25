import type { DeploymentLatestRunLogsQuery, DeploymentRunLogsByIdQuery } from '@compartment/contracts';
import { buildListPath } from './list-path.service';

interface BuildProjectDeploymentLogsPathInput {
  environmentName?: string | undefined;
  pathname: string;
  projectName: string;
  serviceName?: string | undefined;
  since?: string | undefined;
  tailLines?: number | undefined;
}

interface BuildProjectLatestRunLogsPathInput
  extends BuildProjectDeploymentLogsPathInput, DeploymentLatestRunLogsQuery {}

interface BuildProjectDeploymentRunLogsByIdPathInput
  extends BuildProjectDeploymentLogsPathInput, DeploymentRunLogsByIdQuery {}

type BuildProjectDeploymentRunLogsPathInput =
  | BuildProjectLatestRunLogsPathInput
  | BuildProjectDeploymentRunLogsByIdPathInput;

export function buildProjectDeploymentLogsPath(input: BuildProjectDeploymentLogsPathInput): string {
  return buildListPath(input.pathname, [
    { name: 'projectName', value: input.projectName },
    { name: 'environmentName', value: input.environmentName },
    { name: 'serviceName', value: input.serviceName },
    { name: 'since', value: input.since },
    { name: 'tailLines', value: input.tailLines },
  ]);
}

export function buildProjectDeploymentRunLogsPath(input: BuildProjectDeploymentRunLogsPathInput): string {
  if (input.selector === 'latest') {
    return buildLatestDeploymentRunLogsPath(input);
  }

  return buildDeploymentRunLogsByIdPath(input);
}

function buildLatestDeploymentRunLogsPath(input: BuildProjectLatestRunLogsPathInput): string {
  return buildListPath(input.pathname, [
    { name: 'projectName', value: input.projectName },
    { name: 'selector', value: input.selector },
    { name: 'environmentName', value: input.environmentName },
    { name: 'serviceName', value: input.serviceName },
    { name: 'since', value: input.since },
    { name: 'tailLines', value: input.tailLines },
  ]);
}

function buildDeploymentRunLogsByIdPath(input: BuildProjectDeploymentRunLogsByIdPathInput): string {
  return buildListPath(input.pathname, [
    { name: 'projectName', value: input.projectName },
    { name: 'selector', value: input.selector },
    { name: 'deploymentRunId', value: input.deploymentRunId },
    { name: 'environmentName', value: input.environmentName },
    { name: 'serviceName', value: input.serviceName },
    { name: 'since', value: input.since },
    { name: 'tailLines', value: input.tailLines },
  ]);
}
