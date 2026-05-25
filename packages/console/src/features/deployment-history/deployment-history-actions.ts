import {
  compartmentDeploymentsRollbackPathname,
  deployResponseSchema,
  type DeployResponse,
  type RollbackDeploymentRequest,
} from '@compartment/contracts/browser';
import { requestBrowserApi } from '../../lib/browser-api';

export type DeploymentHistoryRollbackHandler = (response?: DeployResponse, error?: Error) => Promise<void> | void;

export interface RollbackDeploymentRunInput {
  environmentName: string;
  organizationSlug: string;
  projectName: string;
  targetDeploymentRunId: string;
}

export type DeploymentHistoryActionErrorLike = Error | { message: string } | string | null | undefined;

interface RollbackDeploymentRequestOptions {
  currentOrganization: string;
  json: RollbackDeploymentRequest;
  method: 'POST';
}

export async function rollbackDeploymentRun(input: Readonly<RollbackDeploymentRunInput>): Promise<DeployResponse> {
  const body: RollbackDeploymentRequest = {
    environmentName: input.environmentName,
    projectName: input.projectName,
    targetDeploymentRunId: input.targetDeploymentRunId,
  };
  const options: RollbackDeploymentRequestOptions = {
    currentOrganization: input.organizationSlug,
    json: body,
    method: 'POST',
  };

  return await requestBrowserApi<DeployResponse, RollbackDeploymentRequest>(
    compartmentDeploymentsRollbackPathname,
    deployResponseSchema,
    options,
  );
}

export function readRollbackDeploymentRunConfirmationMessage(input: Readonly<RollbackDeploymentRunInput>): string {
  return `Roll back ${input.projectName} ${input.environmentName} to deployment run ${input.targetDeploymentRunId}? This will create a new rollback run for all services in that environment.`;
}

export function toDeploymentHistoryActionError(error: DeploymentHistoryActionErrorLike): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  if (error !== null && error !== undefined) {
    return new Error(error.message);
  }

  return new Error('Deployment rollback failed.');
}
