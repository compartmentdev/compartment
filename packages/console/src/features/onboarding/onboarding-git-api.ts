import {
  buildCompartmentGitHubProviderRegistrationRepositoriesPathname,
  buildCompartmentGitSourceSyncTaskPathname,
  compartmentDeploymentsStatusPathname,
  compartmentGitDescriptorPlanPathname,
  compartmentGitDescriptorPullRequestPathname,
  compartmentGitDescriptorPullRequestStatusPathname,
  compartmentGitHubProviderAccountDiscoveryPathname,
  compartmentGitHubProviderAccountDiscoveryResultPathname,
  compartmentGitHubProviderBootstrapPathname,
  compartmentGitSourceConnectPathname,
  connectGitSourceRequestSchema,
  createGitDescriptorPullRequestRequestSchema,
  deploymentStatusQuerySchema,
  deploymentStatusResponseSchema,
  gitDescriptorPlanRequestSchema,
  gitDescriptorPlanResponseSchema,
  gitDescriptorPullRequestResponseSchema,
  gitDescriptorPullRequestStatusRequestSchema,
  gitDescriptorPullRequestStatusResponseSchema,
  gitHubAccountDiscoveryResultRequestSchema,
  gitHubAccountDiscoveryResultResponseSchema,
  gitHubAccountDiscoveryStartRequestSchema,
  gitHubAccountDiscoveryStartResponseSchema,
  gitHubInstallationRepositoryListRequestSchema,
  gitHubInstallationRepositoryListResponseSchema,
  gitHubProviderBootstrapRequestSchema,
  gitHubProviderBootstrapResponseSchema,
  gitSourceResponseSchema,
  gitSourceSyncTaskResponseSchema,
  type ConnectGitSourceRequest,
  type CreateGitDescriptorPullRequestRequest,
  type DeploymentStatusQuery,
  type DeploymentStatusResponse,
  type GitDescriptorPlanRequest,
  type GitDescriptorPlanResponse,
  type GitDescriptorPullRequestResponse,
  type GitDescriptorPullRequestStatusRequest,
  type GitDescriptorPullRequestStatusResponse,
  type GitHubAccountDiscoveryResultRequest,
  type GitHubAccountDiscoveryResultResponse,
  type GitHubAccountDiscoveryStartRequest,
  type GitHubAccountDiscoveryStartResponse,
  type GitHubInstallationRepositoryListRequest,
  type GitHubInstallationRepositoryListResponse,
  type GitHubProviderBootstrapRequest,
  type GitHubProviderBootstrapResponse,
  type GitSourceResponse,
  type GitSourceSyncTaskResponse,
} from '@compartment/contracts/browser';
import { requestBrowserApi } from '../../lib/browser-api';

export async function startBrowserGitHubProviderBootstrap(
  currentOrganization: string,
  body: GitHubProviderBootstrapRequest,
): Promise<GitHubProviderBootstrapResponse> {
  return await requestBrowserApi(compartmentGitHubProviderBootstrapPathname, gitHubProviderBootstrapResponseSchema, {
    currentOrganization,
    json: gitHubProviderBootstrapRequestSchema.parse(body),
    method: 'POST',
  });
}

export async function startBrowserGitHubAccountDiscovery(
  currentOrganization: string,
  body: GitHubAccountDiscoveryStartRequest,
): Promise<GitHubAccountDiscoveryStartResponse> {
  return await requestBrowserApi(
    compartmentGitHubProviderAccountDiscoveryPathname,
    gitHubAccountDiscoveryStartResponseSchema,
    {
      currentOrganization,
      json: gitHubAccountDiscoveryStartRequestSchema.parse(body),
      method: 'POST',
    },
  );
}

export async function readBrowserGitHubAccountDiscoveryResult(
  currentOrganization: string,
  body: GitHubAccountDiscoveryResultRequest,
): Promise<GitHubAccountDiscoveryResultResponse> {
  return await requestBrowserApi(
    compartmentGitHubProviderAccountDiscoveryResultPathname,
    gitHubAccountDiscoveryResultResponseSchema,
    {
      currentOrganization,
      json: gitHubAccountDiscoveryResultRequestSchema.parse(body),
      method: 'POST',
    },
  );
}

export async function listBrowserGitHubInstallationRepositories(
  currentOrganization: string,
  registrationId: string,
  query: GitHubInstallationRepositoryListRequest,
): Promise<GitHubInstallationRepositoryListResponse> {
  return await requestBrowserApi(
    buildCompartmentGitHubProviderRegistrationRepositoriesPathname(
      registrationId,
      gitHubInstallationRepositoryListRequestSchema.parse(query),
    ),
    gitHubInstallationRepositoryListResponseSchema,
    { currentOrganization },
  );
}

export async function readBrowserGitDescriptorPlan(
  currentOrganization: string,
  body: GitDescriptorPlanRequest,
): Promise<GitDescriptorPlanResponse> {
  return await requestBrowserApi(compartmentGitDescriptorPlanPathname, gitDescriptorPlanResponseSchema, {
    currentOrganization,
    json: gitDescriptorPlanRequestSchema.parse(body),
    method: 'POST',
  });
}

export async function createBrowserGitDescriptorPullRequest(
  currentOrganization: string,
  body: CreateGitDescriptorPullRequestRequest,
): Promise<GitDescriptorPullRequestResponse> {
  return await requestBrowserApi(compartmentGitDescriptorPullRequestPathname, gitDescriptorPullRequestResponseSchema, {
    currentOrganization,
    json: createGitDescriptorPullRequestRequestSchema.parse(body),
    method: 'POST',
  });
}

export async function readBrowserGitDescriptorPullRequestStatus(
  currentOrganization: string,
  body: GitDescriptorPullRequestStatusRequest,
): Promise<GitDescriptorPullRequestStatusResponse> {
  return await requestBrowserApi(
    compartmentGitDescriptorPullRequestStatusPathname,
    gitDescriptorPullRequestStatusResponseSchema,
    {
      currentOrganization,
      json: gitDescriptorPullRequestStatusRequestSchema.parse(body),
      method: 'POST',
    },
  );
}

export async function connectBrowserGitSource(
  currentOrganization: string,
  body: ConnectGitSourceRequest,
): Promise<GitSourceResponse> {
  return await requestBrowserApi(compartmentGitSourceConnectPathname, gitSourceResponseSchema, {
    currentOrganization,
    json: connectGitSourceRequestSchema.parse(body),
    method: 'POST',
  });
}

export async function readBrowserGitSourceSyncTask(
  currentOrganization: string,
  sourceId: string,
  taskId: string,
): Promise<GitSourceSyncTaskResponse> {
  return await requestBrowserApi(
    buildCompartmentGitSourceSyncTaskPathname(sourceId, taskId),
    gitSourceSyncTaskResponseSchema,
    { currentOrganization },
  );
}

export async function readBrowserDeploymentStatus(
  currentOrganization: string,
  query: DeploymentStatusQuery,
): Promise<DeploymentStatusResponse> {
  const searchParams: URLSearchParams = createDeploymentStatusSearchParams(deploymentStatusQuerySchema.parse(query));
  return await requestBrowserApi(
    `${compartmentDeploymentsStatusPathname}?${searchParams.toString()}`,
    deploymentStatusResponseSchema,
    { currentOrganization },
  );
}

function createDeploymentStatusSearchParams(query: DeploymentStatusQuery): URLSearchParams {
  const searchParams: URLSearchParams = new URLSearchParams({ projectName: query.projectName });
  if (query.deploymentId !== undefined) {
    searchParams.set('deploymentId', query.deploymentId);
  }
  if (query.environmentName !== undefined) {
    searchParams.set('environmentName', query.environmentName);
  }
  if (query.serviceName !== undefined) {
    searchParams.set('serviceName', query.serviceName);
  }
  return searchParams;
}
