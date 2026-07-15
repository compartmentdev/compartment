import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FirstDeployOnboardingSession, FirstDeployOnboardingStatusResponse } from '@compartment/contracts';
import {
  patchFirstDeployOnboarding,
  readFirstDeployOnboardingStatus,
} from '../src/services/onboarding-first-deploy.service';
import type { CliLoginAttemptRow } from '../src/queries/cli-login.query.types';
import type { DeploymentRunRow } from '../src/queries/deployment-runs.query.types';
import type { DeploymentJoinedRow, DeploymentRow } from '../src/queries/deployments.query.types';
import type { FirstDeployOnboardingSessionRow } from '../src/queries/onboarding-first-deploy.query.types';

interface OnboardingFirstDeployServiceMocks {
  createFirstDeployOnboardingSession: Mock;
  findFirstDeployOnboardingSessionForPrincipal: Mock;
  findLatestCliLoginAttemptByOnboardingSessionId: Mock;
  findLatestDeploymentRunByOnboardingSessionId: Mock;
  getApiConfig: Mock;
  listJoinedDeploymentsForEnvironmentRun: Mock;
  patchFirstDeployOnboardingSessionForPrincipal: Mock;
}

const mocks: OnboardingFirstDeployServiceMocks = vi.hoisted(
  (): OnboardingFirstDeployServiceMocks => ({
    createFirstDeployOnboardingSession: vi.fn(),
    findFirstDeployOnboardingSessionForPrincipal: vi.fn(),
    findLatestCliLoginAttemptByOnboardingSessionId: vi.fn(),
    findLatestDeploymentRunByOnboardingSessionId: vi.fn(),
    getApiConfig: vi.fn(),
    listJoinedDeploymentsForEnvironmentRun: vi.fn(),
    patchFirstDeployOnboardingSessionForPrincipal: vi.fn(),
  }),
);

vi.mock(
  '../src/queries/onboarding-first-deploy.query',
  (): Record<string, Mock> => ({
    createFirstDeployOnboardingSession: mocks.createFirstDeployOnboardingSession,
    findFirstDeployOnboardingSessionForPrincipal: mocks.findFirstDeployOnboardingSessionForPrincipal,
    patchFirstDeployOnboardingSessionForPrincipal: mocks.patchFirstDeployOnboardingSessionForPrincipal,
  }),
);

vi.mock(
  '../src/queries/cli-login.query',
  (): Record<string, Mock> => ({
    findLatestCliLoginAttemptByOnboardingSessionId: mocks.findLatestCliLoginAttemptByOnboardingSessionId,
  }),
);

vi.mock(
  '../src/queries/deployment-runs.query',
  (): Record<string, Mock> => ({
    findLatestDeploymentRunByOnboardingSessionId: mocks.findLatestDeploymentRunByOnboardingSessionId,
  }),
);

vi.mock(
  '../src/queries/deployment-joined.query',
  (): Record<string, Mock> => ({
    listJoinedDeploymentsForEnvironmentRun: mocks.listJoinedDeploymentsForEnvironmentRun,
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): Record<string, Mock> => ({
    getApiConfig: mocks.getApiConfig,
  }),
);

describe('first deploy onboarding service', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
    mocks.getApiConfig.mockReturnValue({ baseDomain: 'localhost' });
  });

  it('derives CLI login progress from the latest server-side attempt for the current organization', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(createSessionRow());
    mocks.findLatestDeploymentRunByOnboardingSessionId.mockResolvedValueOnce(undefined);
    mocks.findLatestCliLoginAttemptByOnboardingSessionId.mockResolvedValueOnce(
      createCliAttemptRow({
        authenticatedAt: new Date('2026-04-21T10:01:00.000Z'),
      }),
    );

    const response: FirstDeployOnboardingStatusResponse = await readFirstDeployOnboardingStatus({
      actorPrincipalId: 'prn_123',
      organizationId: 'org_123',
      organizationSlug: 'acme-dev',
      sessionId: 'fdo_123',
    });

    expect(response.status).toBe('cli_login_authenticated');
    expect(response.statusText).toBe('CLI login is confirmed.');
    expect(mocks.findFirstDeployOnboardingSessionForPrincipal).toHaveBeenCalledWith('org_123', 'fdo_123', 'prn_123');
    expect(mocks.findLatestCliLoginAttemptByOnboardingSessionId).toHaveBeenCalledWith('fdo_123', 'org_123');
  });

  it('derives deployment progress from the latest server-side deployment run for the current organization', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(createSessionRow());
    mocks.findLatestDeploymentRunByOnboardingSessionId.mockResolvedValueOnce(createDeploymentRunRow());
    mocks.listJoinedDeploymentsForEnvironmentRun.mockResolvedValueOnce([
      {
        deployment: createDeploymentRow({
          status: 'succeeded',
        }),
      } as DeploymentJoinedRow,
    ]);

    const response: FirstDeployOnboardingStatusResponse = await readFirstDeployOnboardingStatus({
      actorPrincipalId: 'prn_123',
      organizationId: 'org_123',
      organizationSlug: 'acme-dev',
      sessionId: 'fdo_123',
    });

    expect(response.status).toBe('deploy_succeeded');
    expect(response.statusText).toBe('First deploy completed.');
    expect(mocks.findLatestDeploymentRunByOnboardingSessionId).toHaveBeenCalledWith('fdo_123', 'org_123');
    expect(mocks.listJoinedDeploymentsForEnvironmentRun).toHaveBeenCalledWith('env_123', 'drn_123', 'localhost');
    expect(mocks.findLatestCliLoginAttemptByOnboardingSessionId).not.toHaveBeenCalled();
  });

  it('keeps mixed deployment runs pending until every deployment succeeds', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(createSessionRow());
    mocks.findLatestDeploymentRunByOnboardingSessionId.mockResolvedValueOnce(createDeploymentRunRow());
    mocks.listJoinedDeploymentsForEnvironmentRun.mockResolvedValueOnce([
      {
        deployment: createDeploymentRow({
          id: 'dep_succeeded',
          status: 'succeeded',
        }),
      } as DeploymentJoinedRow,
      {
        deployment: createDeploymentRow({
          id: 'dep_queued',
          status: 'queued',
        }),
      } as DeploymentJoinedRow,
    ]);

    const response: FirstDeployOnboardingStatusResponse = await readFirstDeployOnboardingStatus({
      actorPrincipalId: 'prn_123',
      organizationId: 'org_123',
      organizationSlug: 'acme-dev',
      sessionId: 'fdo_123',
    });

    expect(response.status).toBe('deploy_pending');
  });

  it('reports deployment failure before success for mixed deployment runs', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(createSessionRow());
    mocks.findLatestDeploymentRunByOnboardingSessionId.mockResolvedValueOnce(createDeploymentRunRow());
    mocks.listJoinedDeploymentsForEnvironmentRun.mockResolvedValueOnce([
      {
        deployment: createDeploymentRow({
          id: 'dep_succeeded',
          status: 'succeeded',
        }),
      } as DeploymentJoinedRow,
      {
        deployment: createDeploymentRow({
          failureMessage: 'Build failed.',
          id: 'dep_failed',
          status: 'failed',
        }),
      } as DeploymentJoinedRow,
    ]);

    const response: FirstDeployOnboardingStatusResponse = await readFirstDeployOnboardingStatus({
      actorPrincipalId: 'prn_123',
      organizationId: 'org_123',
      organizationSlug: 'acme-dev',
      sessionId: 'fdo_123',
    });

    expect(response.status).toBe('deploy_failed');
    expect(response.statusText).toBe('First deploy failed: Build failed.');
  });

  it('formats stored deployment failures without parsing runtime log blocks', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(createSessionRow());
    mocks.findLatestDeploymentRunByOnboardingSessionId.mockResolvedValueOnce(createDeploymentRunRow());
    mocks.listJoinedDeploymentsForEnvironmentRun.mockResolvedValueOnce([
      {
        deployment: createDeploymentRow({
          failureMessage:
            'runtime readiness failed: process exited\nLast logs:\n[stdout] booting\n[stderr] missing env',
          id: 'dep_failed',
          status: 'failed',
        }),
      } as DeploymentJoinedRow,
    ]);

    const response: FirstDeployOnboardingStatusResponse = await readFirstDeployOnboardingStatus({
      actorPrincipalId: 'prn_123',
      organizationId: 'org_123',
      organizationSlug: 'acme-dev',
      sessionId: 'fdo_123',
    });

    expect(response.status).toBe('deploy_failed');
    expect(response.statusText).toBe('First deploy failed: runtime readiness failed: process exited.');
  });

  it('does not expose sessions created by another principal in the same organization', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(undefined);

    await expect(
      readFirstDeployOnboardingStatus({
        actorPrincipalId: 'prn_other',
        organizationId: 'org_123',
        organizationSlug: 'acme-dev',
        sessionId: 'fdo_123',
      }),
    ).rejects.toThrow('The first deploy onboarding session was not found.');

    expect(mocks.findFirstDeployOnboardingSessionForPrincipal).toHaveBeenCalledWith('org_123', 'fdo_123', 'prn_other');
    expect(mocks.findLatestDeploymentRunByOnboardingSessionId).not.toHaveBeenCalled();
    expect(mocks.findLatestCliLoginAttemptByOnboardingSessionId).not.toHaveBeenCalled();
  });

  it('patches sessions through the owner-scoped query', async (): Promise<void> => {
    mocks.patchFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(
      createSessionRow({
        method: 'cli',
      }),
    );

    const session: FirstDeployOnboardingSession = await patchFirstDeployOnboarding({
      actorPrincipalId: 'prn_123',
      organizationId: 'org_123',
      organizationSlug: 'acme-dev',
      patch: {
        method: 'cli',
      },
      sessionId: 'fdo_123',
    });

    expect(session.method).toBe('cli');
    expect(mocks.patchFirstDeployOnboardingSessionForPrincipal).toHaveBeenCalledWith(
      'org_123',
      'fdo_123',
      'prn_123',
      expect.objectContaining({
        method: 'cli',
      }),
    );
  });
});

function createSessionRow(overrides: Partial<FirstDeployOnboardingSessionRow> = {}): FirstDeployOnboardingSessionRow {
  return {
    createdAt: new Date('2026-04-21T10:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    id: 'fdo_123',
    method: 'cli',
    organizationId: 'org_123',
    skippedAt: null,
    state: 'active',
    updatedAt: new Date('2026-04-21T10:00:00.000Z'),
    ...overrides,
  };
}

function createCliAttemptRow(overrides: Partial<CliLoginAttemptRow> = {}): CliLoginAttemptRow {
  return {
    authenticatedAt: null,
    authenticatedAuthMethodKind: null,
    authenticatedOidcProviderId: null,
    authenticatedPrincipalId: null,
    browserCodeHash: 'browser-hash',
    createdAt: new Date('2026-04-21T10:00:00.000Z'),
    exchangedAt: null,
    exchangeSecretHash: 'exchange-hash',
    expectedPrincipalEmail: 'admin@example.com',
    expiresAt: new Date('2099-04-21T10:10:00.000Z'),
    id: 'cla_123',
    onboardingSessionId: 'fdo_123',
    organizationId: 'org_123',
    ...overrides,
  };
}

function createDeploymentRunRow(overrides: Partial<DeploymentRunRow> = {}): DeploymentRunRow {
  return {
    createdAt: new Date('2026-04-21T10:02:00.000Z'),
    environmentId: 'env_123',
    id: 'drn_123',
    label: null,
    onboardingSessionId: 'fdo_123',
    sourceAutomationPrincipalId: null,
    sourceBindingId: null,
    sourceBindingSnapshotJson: null,
    sourceCommitSha: null,
    sourceEventId: null,
    sourceId: null,
    sourceKind: null,
    sourceRepositorySnapshotJson: null,
    sourceResolutionTaskId: null,
    triggerType: 'manual',
    updatedAt: new Date('2026-04-21T10:02:00.000Z'),
    ...overrides,
  };
}

function createDeploymentRow(overrides: Partial<DeploymentRow> = {}): DeploymentRow {
  return {
    accessMode: 'authenticated',
    buildArtifactId: 'art_123',
    completedAt: null,
    createdAt: new Date('2026-04-21T10:02:00.000Z'),
    deploymentRunId: 'drn_123',
    environmentId: 'env_123',
    failureMessage: null,
    health: 'healthy',
    id: 'dep_123',
    isActive: false,
    label: null,
    movementSourceDeploymentId: null,
    operationId: 'op_123',
    projectServiceId: 'svc_123',
    promotionStage: 'active',
    resolvedReadinessJson: '{}',
    resolvedReleaseJson: 'null',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    routeBaseDomain: null,
    routeHost: null,
    sourceAutomationPrincipalId: null,
    sourceBindingId: null,
    sourceBindingSnapshotJson: null,
    sourceCommitSha: null,
    sourceEventId: null,
    sourceId: null,
    sourceKind: null,
    sourceRepositorySnapshotJson: null,
    sourceResolutionTaskId: null,
    status: 'queued',
    updatedAt: new Date('2026-04-21T10:02:00.000Z'),
    ...overrides,
  };
}
