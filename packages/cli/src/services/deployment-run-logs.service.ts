import type { DeploymentRunLogsResponse } from '@compartment/contracts';
import { getDeploymentRunLogs, type CompartmentRequester } from '@compartment/sdk';
import { createProjectRequester } from './deployment-operation-runner.service';
import { resolveProjectTarget } from './project-target.service';
import type { AuthenticatedContext } from './context.types';
import type { DeploymentLogsCommandInput } from './deployments.types';
import type { ResolvedProjectTarget } from './projects.service.types';

export async function getProjectDeploymentRunLogs(
  context: AuthenticatedContext,
  input: DeploymentLogsCommandInput,
): Promise<DeploymentRunLogsResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  if (input.selector === 'latest') {
    return await getDeploymentRunLogs(request, {
      environmentName: input.environmentName,
      projectName: target.projectName,
      selector: 'latest',
      serviceName: input.serviceName,
      since: input.since,
    });
  }

  return await getDeploymentRunLogs(request, {
    deploymentRunId: input.deploymentRunId,
    environmentName: input.environmentName,
    projectName: target.projectName,
    selector: 'run',
    serviceName: input.serviceName,
    since: input.since,
  });
}
