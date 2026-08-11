import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
  type AccessGroupSummary,
  type AccessGroupResponse,
  type AccessRoleSummary,
  type AccessRoleResponse,
  type CreateCustomDomainResponse,
  type CustomDomainDnsRecord,
  type CustomDomainSummary,
  type DeploymentInspectRuntimeSummary,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentInfrastructureBlocker,
  type DeploymentReadEnvironmentSummary,
  type DeploymentReadOperationSummary,
  type DeploymentReadProjectSummary,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type EnvironmentSummary,
  type InviteUserResponse,
  type OperationSummary,
  type OrganizationSummary,
  type OrganizationUserResponse,
  type OrganizationUserSummary,
  type PermissionKey,
  type PrincipalSummary,
  type ProjectOverviewSummary,
  type ProjectRouteTargetSummary,
  type ProjectStatusSummary,
  type ProjectSummary,
  type ResolvedCompartmentServiceRunConfig,
  type ResolvedOptionalServiceReadinessConfig,
  type SsoOidcProviderSummary,
  type SsoOidcProviderResponse,
  type UserAccessDetail,
  type UserInvitation,
  type UserAccessDetailResponse,
  type WhoAmIResponse,
} from '../src';

interface BuildDeploymentInspectTargetInput extends Partial<DeploymentInspectTarget> {
  operation?: OperationSummary;
  readiness?: ResolvedOptionalServiceReadinessConfig;
  run?: ResolvedCompartmentServiceRunConfig;
  runtime?: DeploymentInspectRuntimeSummary | null;
}

interface BuildDeploymentReadSummaryInput extends Omit<Partial<DeploymentReadSummary>, 'operation'> {
  operation?: Partial<DeploymentReadOperationSummary>;
}

interface BuildDeploymentStatusResponseInput {
  activeDeployments?: DeploymentReadSummary[];
  deployments?: DeploymentReadSummary[];
  environment?: DeploymentReadEnvironmentSummary;
  infrastructureBlocker?: DeploymentInfrastructureBlocker | null;
  project?: DeploymentReadProjectSummary;
}

interface BuildDeploymentInspectResponseInput extends Partial<DeploymentInspectResponse> {
  activeDeployments?: DeploymentInspectTarget[];
  deployments?: DeploymentInspectTarget[];
  environment?: EnvironmentSummary;
  project?: ProjectSummary;
}

interface BuildWhoAmIResponseInput {
  currentOrganization?: OrganizationSummary | null;
  currentOrganizationPermissions?: PermissionKey[];
  principal?: Partial<PrincipalSummary>;
}

interface BuildInviteUserResponseInput {
  invitation?: UserInvitation | null;
  user?: Partial<OrganizationUserSummary>;
}

interface BuildAccessRoleResponseInput {
  role?: Partial<AccessRoleSummary>;
}

interface BuildAccessGroupResponseInput {
  group?: Partial<AccessGroupSummary>;
}

interface BuildOrganizationUserResponseInput {
  user?: Partial<OrganizationUserSummary>;
}

interface BuildUserAccessDetailResponseInput {
  access?: Partial<UserAccessDetail>;
}

interface BuildSsoOidcProviderResponseInput {
  provider?: Partial<SsoOidcProviderSummary> | null;
}

interface BuildCreateCustomDomainResponseInput {
  dnsRecords?: CustomDomainDnsRecord[];
  domain?: Partial<CustomDomainSummary>;
}

function buildOrganizationSummary(overrides: Partial<OrganizationSummary> = {}): OrganizationSummary {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
    ...overrides,
  };
}

function buildPrincipalSummary(overrides: Partial<PrincipalSummary> = {}): PrincipalSummary {
  return {
    email: 'admin@example.com',
    id: 'prn_123',
    type: 'user',
    ...overrides,
  };
}

export function buildProjectSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    archivedAt: null,
    createdAt: '2026-03-24T09:00:00.000Z',
    id: 'prj_123',
    name: 'smoke-web',
    organizationId: 'org_123',
    updatedAt: '2026-03-24T10:00:00.000Z',
    ...overrides,
  };
}

function buildProjectRouteTargetSummary(overrides: Partial<ProjectRouteTargetSummary> = {}): ProjectRouteTargetSummary {
  return {
    environmentName: 'production',
    routeUrl: 'https://smoke.example.com',
    serviceName: 'web',
    ...overrides,
  };
}

export function buildProjectOverviewSummary(overrides: Partial<ProjectOverviewSummary> = {}): ProjectOverviewSummary {
  return {
    ...buildProjectSummary(),
    canManageArchive: true,
    canManageLifecycle: true,
    canReadDeployments: true,
    environmentName: 'production',
    lastDeploymentCreatedAt: '2026-03-24T10:00:00.000Z',
    lifecycleAction: 'stop',
    lifecycleDisabledReason: null,
    lifecycleState: 'running',
    openTargets: [buildProjectRouteTargetSummary()],
    routeUrl: 'https://smoke.example.com',
    serviceCount: 1,
    status: 'healthy',
    ...overrides,
  };
}

export function buildProjectStatusSummary(overrides: Partial<ProjectStatusSummary> = {}): ProjectStatusSummary {
  return {
    id: 'prj_123',
    lifecycleAction: 'stop',
    lifecycleDisabledReason: null,
    lifecycleState: 'running',
    openTargets: [buildProjectRouteTargetSummary()],
    routeUrl: 'https://smoke.example.com',
    status: 'healthy',
    ...overrides,
  };
}

export function buildDeploymentReadSummary(overrides: BuildDeploymentReadSummaryInput = {}): DeploymentReadSummary {
  const defaultDeployment: DeploymentReadSummary = {
    completedAt: '2026-03-24T10:00:00.000Z',
    createdAt: '2026-03-24T09:00:00.000Z',
    deploymentRunId: 'drn_123',
    failureMessage: null,
    health: 'healthy',
    id: 'dep_123',
    isActive: true,
    label: null,
    operation: {
      completedAt: '2026-03-24T10:00:00.000Z',
      createdAt: '2026-03-24T09:00:00.000Z',
      status: 'succeeded',
      type: 'deployment.create',
    },
    promotionStage: 'active',
    rollbackAvailable: false,
    routeUrl: 'https://smoke-web.example.com',
    serviceName: 'web',
    status: 'running',
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

export function buildDeploymentStatusResponse(
  input: BuildDeploymentStatusResponseInput = {},
): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = buildDeploymentReadSummary();

  return {
    activeDeployments: input.activeDeployments ?? [deployment],
    deployments: input.deployments ?? [deployment],
    environment: input.environment ?? { name: 'production' },
    infrastructureBlocker: input.infrastructureBlocker ?? null,
    project: input.project ?? { name: 'smoke-web' },
  };
}

export function buildDeploymentInspectTarget(
  overrides: BuildDeploymentInspectTargetInput = {},
): DeploymentInspectTarget {
  const defaultTarget: DeploymentInspectTarget = {
    build: {
      env: [],
      include: [],
      packages: {
        build: [],
        runtime: [],
      },
      strategy: 'auto',
    },
    completedAt: '2026-03-24T10:00:00.000Z',
    createdAt: '2026-03-24T09:00:00.000Z',
    failureMessage: null,
    health: 'healthy',
    id: 'dep_123',
    isActive: true,
    label: null,
    operation: {
      completedAt: '2026-03-24T10:00:00.000Z',
      createdAt: '2026-03-24T09:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'dep_123',
      targetType: 'deployment',
      type: 'deployment.create',
    },
    promotionStage: 'active',
    readiness: {
      path: '/ready',
      timeoutMs: 30000,
      type: 'http',
    },
    rollbackAvailable: false,
    routeHost: 'smoke-railpack.localhost',
    routes: [],
    routeUrl: 'http://smoke-railpack.localhost:9080',
    run: {},
    runtime: {
      imageRef: 'sha256:image',
      routeHost: 'smoke-railpack.localhost',
      serviceHost: 'web.cpt-smoke.svc',
      servicePort: 80,
    },
    serviceName: 'web',
    status: 'succeeded',
  };

  return {
    ...defaultTarget,
    ...overrides,
    build: overrides.build ?? defaultTarget.build,
    operation: overrides.operation ?? defaultTarget.operation,
    readiness: overrides.readiness ?? defaultTarget.readiness,
    routes: overrides.routes ?? defaultTarget.routes,
    run: overrides.run ?? defaultTarget.run,
    runtime: 'runtime' in overrides ? (overrides.runtime ?? null) : defaultTarget.runtime,
  };
}

export function buildDeploymentInspectResponse(
  overrides: BuildDeploymentInspectResponseInput = {},
): DeploymentInspectResponse {
  const activeDeployment: DeploymentInspectTarget = buildDeploymentInspectTarget();

  return {
    activeDeployments: overrides.activeDeployments ?? [activeDeployment],
    deployments: overrides.deployments ?? [],
    environment: overrides.environment ?? {
      createdAt: '2026-03-24T09:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-03-24T09:00:00.000Z',
    },
    project: overrides.project ?? buildProjectSummary(),
    sensitiveTopologyVisible: overrides.sensitiveTopologyVisible ?? true,
  };
}

export function buildWhoAmIResponse(input: BuildWhoAmIResponseInput = {}): WhoAmIResponse {
  return {
    currentOrganization:
      'currentOrganization' in input ? (input.currentOrganization ?? null) : buildOrganizationSummary(),
    currentOrganizationPermissions: input.currentOrganizationPermissions ?? ['project.read'],
    principal: buildPrincipalSummary(input.principal),
  };
}

function buildOrganizationUserSummary(overrides: Partial<OrganizationUserSummary> = {}): OrganizationUserSummary {
  return {
    access: 'allowed',
    email: 'viewer@example.com',
    groupCount: 0,
    id: 'prn_456',
    roleNames: ['Viewer'],
    status: 'invited',
    type: 'user',
    ...overrides,
  };
}

export function buildInviteUserResponse(input: BuildInviteUserResponseInput = {}): InviteUserResponse {
  const defaultInvitation: UserInvitation = {
    activationUrl: 'https://console.example.com/activate?email=viewer%40example.com&token=bootstrap_123',
    bootstrapExpiresAt: '2099-03-31T00:00:00.000Z',
    bootstrapToken: 'bootstrap_123',
  };

  return {
    invitation: 'invitation' in input ? (input.invitation ?? null) : defaultInvitation,
    user: buildOrganizationUserSummary(input.user),
  };
}

export function buildAccessRoleResponse(input: BuildAccessRoleResponseInput = {}): AccessRoleResponse {
  return {
    role: {
      description: null,
      id: 'rol_123',
      kind: 'custom',
      name: 'Project Operator',
      permissionKeys: ['deployment.create', 'variable.write'],
      ...input.role,
    },
  };
}

export function buildAccessGroupResponse(input: BuildAccessGroupResponseInput = {}): AccessGroupResponse {
  return {
    group: {
      assignmentCount: 1,
      description: null,
      id: 'grp_123',
      memberCount: 2,
      name: 'Operators',
      ...input.group,
    },
  };
}

export function buildOrganizationUserResponse(
  input: BuildOrganizationUserResponseInput = {},
): OrganizationUserResponse {
  return {
    user: buildOrganizationUserSummary(input.user),
  };
}

export function buildUserAccessDetailResponse(
  input: BuildUserAccessDetailResponseInput = {},
): UserAccessDetailResponse {
  return {
    access: {
      directAssignments: [],
      effectivePermissions: ['project.read', 'deployment.read'],
      groups: [buildAccessGroupResponse().group],
      user: buildOrganizationUserSummary({ groupCount: 1, roleNames: ['Project Viewer'], status: 'active' }),
      ...input.access,
    },
  };
}

export function buildSsoOidcProviderResponse(input: BuildSsoOidcProviderResponseInput = {}): SsoOidcProviderResponse {
  return {
    provider:
      input.provider === null
        ? null
        : {
            buttonText: 'Login with Google',
            clientId: 'client_123',
            createdAt: '2026-04-21T10:00:00.000Z',
            displayName: 'Google',
            id: 'sop_123',
            identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
            issuerUrl: 'https://accounts.google.com',
            key: 'google',
            preset: 'google',
            provisioning: buildDisabledSsoOidcProvisioningPolicy(),
            scope: 'openid email profile',
            updatedAt: '2026-04-21T10:00:00.000Z',
            ...input.provider,
          },
  };
}

function buildCustomDomainSummary(overrides: Partial<CustomDomainSummary> = {}): CustomDomainSummary {
  return {
    canonicalRouteHost: 'billing.example.com',
    createdAt: '2026-04-23T10:00:00.000Z',
    environmentName: 'production',
    failureMessage: null,
    host: 'app.example.com',
    lastCheckedAt: null,
    ownershipStatus: 'pending',
    projectName: 'billing',
    routingStatus: 'pending',
    serviceName: 'web',
    status: 'pending',
    updatedAt: '2026-04-23T10:00:00.000Z',
    verifiedAt: null,
    ...overrides,
  };
}

export function buildCreateCustomDomainResponse(
  input: BuildCreateCustomDomainResponseInput = {},
): CreateCustomDomainResponse {
  return {
    dnsRecords: input.dnsRecords ?? [
      {
        groupId: 'ownership',
        name: '_compartment-domain.app.example.com',
        purpose: 'ownership',
        recordType: 'TXT',
        required: true,
        value: 'compartment-domain-verification=cdom_123',
      },
      {
        groupId: 'routing',
        name: 'app.example.com',
        purpose: 'routing',
        recordType: 'CNAME',
        required: true,
        value: 'billing.example.com',
      },
    ],
    domain: buildCustomDomainSummary(input.domain),
  };
}
