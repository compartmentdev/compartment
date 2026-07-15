import type {
  DeployResponse,
  DeploymentSummary,
  DeploymentReadEnvironmentSummary,
  DeploymentReadOperationSummary,
  DeploymentReadProjectSummary,
  DeploymentReadSummary,
  DeploymentStatusResponse,
  EnvironmentSummary,
  LoginResponse,
  OrganizationSummary,
  PrincipalSummary,
  ProjectSummary,
  ResourceSummary,
} from '@compartment/contracts';
import type { CliConfig, CliOrganizationConfig, CliRemoteConfig } from '../src/store/config.types';

interface DeploymentReadSummaryFixtureInput extends Omit<Partial<DeploymentReadSummary>, 'operation'> {
  operation?: Partial<DeploymentReadOperationSummary> | undefined;
}

interface DeploymentStatusResponseFixtureInput {
  activeDeployments: DeploymentReadSummary[];
  deployments: DeploymentReadSummary[];
  environment?: Partial<DeploymentReadEnvironmentSummary> | undefined;
  project?: Partial<DeploymentReadProjectSummary> | undefined;
}

interface SingleDeploymentStatusResponseFixtureInput {
  deployment?: DeploymentReadSummaryFixtureInput | undefined;
  environment?: Partial<DeploymentReadEnvironmentSummary> | undefined;
  project?: Partial<DeploymentReadProjectSummary> | undefined;
}

interface CreateDeployResponseFixtureInput {
  deployment?: Partial<DeploymentSummary> | undefined;
  deployments?: DeploymentSummary[] | undefined;
  environment?: Partial<EnvironmentSummary> | undefined;
  project?: Partial<ProjectSummary> | undefined;
  resources?: ResourceSummary[] | undefined;
}

interface CreateLoginResponseFixtureInput {
  organizations?: OrganizationSummary[] | undefined;
  principal?: Partial<PrincipalSummary> | undefined;
  sessionToken?: string | undefined;
}

interface CreateCliConfigFixtureInput extends Partial<CliConfig> {
  apiUrl?: string | undefined;
  currentOrganization?: CliOrganizationConfig | undefined;
  firstDeployOnboardingSessionId?: string | undefined;
  principalEmail?: string | undefined;
  remoteName?: string | undefined;
  sessionToken?: string | undefined;
}

export function createCliOrganizationFixture(overrides: Partial<CliOrganizationConfig> = {}): CliOrganizationConfig {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
    ...overrides,
  };
}

export function createCliRemoteConfigFixture(overrides: Partial<CliRemoteConfig> = {}): CliRemoteConfig {
  return {
    apiUrl: 'https://console.example',
    currentOrganization: createCliOrganizationFixture(),
    principalEmail: 'admin@example.com',
    sessionToken: 'session_123',
    ...overrides,
  };
}

export function createCliConfigFixture(input: CreateCliConfigFixtureInput = {}): CliConfig {
  const remoteName: string = input.remoteName ?? input.currentRemote ?? 'default';
  const defaultRemote: CliRemoteConfig = createCliRemoteConfigFixture();
  if (input.apiUrl !== undefined) {
    defaultRemote.apiUrl = input.apiUrl;
  }
  if ('currentOrganization' in input) {
    defaultRemote.currentOrganization = input.currentOrganization;
  }
  if ('principalEmail' in input) {
    defaultRemote.principalEmail = input.principalEmail;
  }
  if ('firstDeployOnboardingSessionId' in input) {
    defaultRemote.firstDeployOnboardingSessionId = input.firstDeployOnboardingSessionId;
  }
  if ('sessionToken' in input) {
    defaultRemote.sessionToken = input.sessionToken;
  }
  const remotes: Record<string, CliRemoteConfig> = {
    [remoteName]: defaultRemote,
    ...(input.remotes ?? {}),
  };

  return {
    currentRemote: input.currentRemote ?? remoteName,
    remotes,
  };
}

function createDeploymentReadSummaryFixture(overrides: DeploymentReadSummaryFixtureInput = {}): DeploymentReadSummary {
  const defaultDeployment: DeploymentReadSummary = {
    completedAt: '2026-03-30T10:00:05.000Z',
    createdAt: '2026-03-30T10:00:00.000Z',
    deploymentRunId: 'drn_123',
    failureMessage: null,
    health: 'healthy',
    id: 'dep_123',
    isActive: true,
    label: null,
    operation: {
      completedAt: '2026-03-30T10:00:05.000Z',
      createdAt: '2026-03-30T10:00:00.000Z',
      status: 'succeeded',
      type: 'deployment.create',
    },
    promotionStage: 'active',
    rollbackAvailable: false,
    routeUrl: 'https://smoke-web.preview.acme.dev',
    serviceName: 'web',
    status: 'succeeded',
  };

  return {
    ...defaultDeployment,
    ...overrides,
    operation: {
      ...defaultDeployment.operation,
      ...(overrides.operation ?? {}),
    },
  };
}

export function createActiveDeploymentReadSummaryFixture(
  overrides: DeploymentReadSummaryFixtureInput = {},
): DeploymentReadSummary {
  return createDeploymentReadSummaryFixture({
    isActive: true,
    promotionStage: 'active',
    ...overrides,
  });
}

export function createHistoricalDeploymentReadSummaryFixture(
  overrides: DeploymentReadSummaryFixtureInput = {},
): DeploymentReadSummary {
  return createDeploymentReadSummaryFixture({
    isActive: false,
    ...overrides,
  });
}

export function createDeploymentReadEnvironmentSummaryFixture(
  overrides: Partial<DeploymentReadEnvironmentSummary> = {},
): DeploymentReadEnvironmentSummary {
  return {
    name: 'staging',
    ...overrides,
  };
}

export function createDeploymentReadProjectSummaryFixture(
  overrides: Partial<DeploymentReadProjectSummary> = {},
): DeploymentReadProjectSummary {
  return {
    name: 'smoke-web',
    ...overrides,
  };
}

export function createDeploymentStatusResponseFixture(
  input: DeploymentStatusResponseFixtureInput,
): DeploymentStatusResponse {
  return {
    activeDeployments: input.activeDeployments,
    deployments: input.deployments,
    environment: createDeploymentReadEnvironmentSummaryFixture(input.environment),
    project: createDeploymentReadProjectSummaryFixture(input.project),
  };
}

export function createActiveDeploymentStatusResponseFixture(
  input: SingleDeploymentStatusResponseFixtureInput = {},
): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = createActiveDeploymentReadSummaryFixture(input.deployment);

  return createDeploymentStatusResponseFixture({
    activeDeployments: [deployment],
    deployments: [deployment],
    environment: input.environment,
    project: input.project,
  });
}

export function createHistoricalDeploymentStatusResponseFixture(
  input: SingleDeploymentStatusResponseFixtureInput = {},
): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = createHistoricalDeploymentReadSummaryFixture(input.deployment);

  return createDeploymentStatusResponseFixture({
    activeDeployments: [],
    deployments: [deployment],
    environment: input.environment,
    project: input.project,
  });
}

export function createEnvironmentSummaryFixture(overrides: Partial<EnvironmentSummary> = {}): EnvironmentSummary {
  return {
    createdAt: '2026-03-30T10:00:00.000Z',
    id: 'env_123',
    name: 'staging',
    projectId: 'prj_123',
    updatedAt: '2026-03-30T10:00:00.000Z',
    ...overrides,
  };
}

export function createProjectSummaryFixture(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    archivedAt: null,
    createdAt: '2026-03-30T10:00:00.000Z',
    id: 'prj_123',
    name: 'smoke-web',
    organizationId: 'org_123',
    updatedAt: '2026-03-30T10:00:00.000Z',
    ...overrides,
  };
}

export function createDeploymentSummaryFixture(overrides: Partial<DeploymentSummary> = {}): DeploymentSummary {
  const defaultDeployment: DeploymentSummary = {
    build: {
      env: [],
      include: [],
      packages: {
        build: [],
        runtime: [],
      },
      strategy: 'auto',
    },
    completedAt: null,
    createdAt: '2026-03-30T10:00:00.000Z',
    failureMessage: null,
    health: 'pending',
    id: 'dep_123',
    isActive: false,
    label: null,
    operation: {
      completedAt: null,
      createdAt: '2026-03-30T10:00:00.000Z',
      id: 'op_123',
      status: 'queued',
      targetId: 'env_123',
      targetType: 'environment',
      type: 'deployment.run',
    },
    promotionStage: 'building',
    readiness: {
      path: '/healthz',
      timeoutMs: 30000,
      type: 'http',
    },
    rollbackAvailable: false,
    routeUrl: null,
    run: {},
    serviceName: 'web',
    status: 'queued',
  };

  return {
    ...defaultDeployment,
    ...overrides,
    build: overrides.build ?? defaultDeployment.build,
    operation: overrides.operation ?? defaultDeployment.operation,
    readiness: overrides.readiness ?? defaultDeployment.readiness,
    run: overrides.run ?? defaultDeployment.run,
  };
}

export function createDeployResponseFixture(input: CreateDeployResponseFixtureInput = {}): DeployResponse {
  return {
    deploymentRunId: 'drn_123',
    deployments: input.deployments ?? [createDeploymentSummaryFixture(input.deployment)],
    environment: createEnvironmentSummaryFixture(input.environment),
    project: createProjectSummaryFixture(input.project),
    resources: input.resources ?? [],
  };
}

export function createLoginResponseFixture(input: CreateLoginResponseFixtureInput = {}): LoginResponse {
  return {
    organizations: input.organizations ?? [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    principal: {
      email: 'owner@example.com',
      id: 'usr_123',
      type: 'user',
      ...input.principal,
    },
    sessionToken: input.sessionToken ?? 'session-token',
  };
}
