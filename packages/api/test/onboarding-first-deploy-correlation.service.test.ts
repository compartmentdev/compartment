import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  readValidatedFirstDeployOnboardingSessionId,
  readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail,
} from '../src/services/onboarding-first-deploy-correlation.service';
import type { findFirstDeployOnboardingSessionForPrincipal } from '../src/queries/onboarding-first-deploy.query';
import type { findPrincipalIdByEmail } from '../src/queries/principal.query';

type FindFirstDeployOnboardingSessionForPrincipal = typeof findFirstDeployOnboardingSessionForPrincipal;
type FindPrincipalIdByEmail = typeof findPrincipalIdByEmail;

interface OnboardingCorrelationServiceMocks {
  findFirstDeployOnboardingSessionForPrincipal: Mock<FindFirstDeployOnboardingSessionForPrincipal>;
  findPrincipalIdByEmail: Mock<FindPrincipalIdByEmail>;
}

const mocks: OnboardingCorrelationServiceMocks = vi.hoisted(
  (): OnboardingCorrelationServiceMocks => ({
    findFirstDeployOnboardingSessionForPrincipal: vi.fn<FindFirstDeployOnboardingSessionForPrincipal>(),
    findPrincipalIdByEmail: vi.fn<FindPrincipalIdByEmail>(),
  }),
);

vi.mock(
  '../src/queries/onboarding-first-deploy.query',
  (): {
    findFirstDeployOnboardingSessionForPrincipal: Mock<FindFirstDeployOnboardingSessionForPrincipal>;
  } => ({
    findFirstDeployOnboardingSessionForPrincipal: mocks.findFirstDeployOnboardingSessionForPrincipal,
  }),
);

vi.mock(
  '../src/queries/principal.query',
  (): {
    findPrincipalIdByEmail: Mock<FindPrincipalIdByEmail>;
  } => ({
    findPrincipalIdByEmail: mocks.findPrincipalIdByEmail,
  }),
);

describe('first deploy onboarding correlation service', (): void => {
  beforeEach((): void => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockReset();
    mocks.findPrincipalIdByEmail.mockReset();
  });

  it('returns null when no onboarding session id is provided', async (): Promise<void> => {
    await expect(
      readValidatedFirstDeployOnboardingSessionId({
        actorPrincipalId: 'prn_123',
        organizationId: 'org_123',
      }),
    ).resolves.toBeNull();

    expect(mocks.findFirstDeployOnboardingSessionForPrincipal).not.toHaveBeenCalled();
  });

  it('validates onboarding sessions for the current actor within the current organization', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce({
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      createdByPrincipalId: 'prn_123',
      id: 'fdo_123',
      method: 'cli',
      organizationId: 'org_123',
      skippedAt: null,
      state: 'active',
      updatedAt: new Date('2026-04-21T10:00:00.000Z'),
    });

    await expect(
      readValidatedFirstDeployOnboardingSessionId({
        actorPrincipalId: 'prn_123',
        onboardingSessionId: 'fdo_123',
        organizationId: 'org_123',
      }),
    ).resolves.toBe('fdo_123');

    expect(mocks.findFirstDeployOnboardingSessionForPrincipal).toHaveBeenCalledWith('org_123', 'fdo_123', 'prn_123');
  });

  it('rejects unknown, cross-organization, or cross-principal onboarding sessions', async (): Promise<void> => {
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce(undefined);

    await expect(
      readValidatedFirstDeployOnboardingSessionId({
        actorPrincipalId: 'prn_other',
        onboardingSessionId: 'fdo_123',
        organizationId: 'org_other',
      }),
    ).rejects.toThrow('The first deploy onboarding session was not found.');

    expect(mocks.findFirstDeployOnboardingSessionForPrincipal).toHaveBeenCalledWith(
      'org_other',
      'fdo_123',
      'prn_other',
    );
  });

  it('validates onboarding sessions for CLI login email owners', async (): Promise<void> => {
    mocks.findPrincipalIdByEmail.mockResolvedValueOnce('prn_123');
    mocks.findFirstDeployOnboardingSessionForPrincipal.mockResolvedValueOnce({
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      createdByPrincipalId: 'prn_123',
      id: 'fdo_123',
      method: 'cli',
      organizationId: 'org_123',
      skippedAt: null,
      state: 'active',
      updatedAt: new Date('2026-04-21T10:00:00.000Z'),
    });

    await expect(
      readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail({
        onboardingSessionId: 'fdo_123',
        organizationId: 'org_123',
        principalEmail: 'admin@example.com',
      }),
    ).resolves.toBe('fdo_123');

    expect(mocks.findPrincipalIdByEmail).toHaveBeenCalledWith('admin@example.com');
    expect(mocks.findFirstDeployOnboardingSessionForPrincipal).toHaveBeenCalledWith('org_123', 'fdo_123', 'prn_123');
  });

  it('rejects CLI login onboarding sessions without an email owner', async (): Promise<void> => {
    await expect(
      readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail({
        onboardingSessionId: 'fdo_123',
        organizationId: 'org_123',
      }),
    ).rejects.toThrow('The first deploy onboarding session was not found.');

    expect(mocks.findPrincipalIdByEmail).not.toHaveBeenCalled();
    expect(mocks.findFirstDeployOnboardingSessionForPrincipal).not.toHaveBeenCalled();
  });
});
