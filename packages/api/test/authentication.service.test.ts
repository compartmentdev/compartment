import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type ApiConfig } from '../src/config';
import { hashToken } from '../src/lib/tokens';
import type { findAuthenticationSessionByTokenHash } from '../src/queries/authentication.query';
import type { AuthenticationSessionRow } from '../src/queries/authentication.query.types';
import type { getApiConfig } from '../src/runtime/runtime-access';
import { authenticateSession } from '../src/services/authentication.service';
import { createApiTestConfig } from './api-config-test.fixtures';

type FindAuthenticationSessionByTokenHash = typeof findAuthenticationSessionByTokenHash;
type GetApiConfig = typeof getApiConfig;
interface AuthenticationServiceMocks {
  findAuthenticationSessionByTokenHash: Mock<FindAuthenticationSessionByTokenHash>;
  getApiConfig: Mock<GetApiConfig>;
}

const mocks: AuthenticationServiceMocks = vi.hoisted(
  (): AuthenticationServiceMocks => ({
    findAuthenticationSessionByTokenHash: vi.fn<FindAuthenticationSessionByTokenHash>(),
    getApiConfig: vi.fn<GetApiConfig>(),
  }),
);

vi.mock(
  '../src/queries/authentication.query',
  (): { findAuthenticationSessionByTokenHash: Mock<FindAuthenticationSessionByTokenHash> } => ({
    findAuthenticationSessionByTokenHash: mocks.findAuthenticationSessionByTokenHash,
  }),
);

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

describe('authentication service', (): void => {
  afterEach((): void => {
    mocks.findAuthenticationSessionByTokenHash.mockReset();
    mocks.getApiConfig.mockReset();
  });

  it('returns null when no active session matches the hashed token', async (): Promise<void> => {
    const config: ApiConfig = createApiTestConfig();
    mocks.getApiConfig.mockReturnValue(config);
    mocks.findAuthenticationSessionByTokenHash.mockResolvedValueOnce(undefined);

    await expect(authenticateSession('session-token')).resolves.toBeNull();
    expect(mocks.findAuthenticationSessionByTokenHash).toHaveBeenCalledWith(
      hashToken('session-token', config.sessionSecret),
    );
  });

  it('returns null when the persisted session principal is not a user', async (): Promise<void> => {
    const config: ApiConfig = createApiTestConfig();
    mocks.getApiConfig.mockReturnValue(config);
    mocks.findAuthenticationSessionByTokenHash.mockResolvedValueOnce({
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalEmail: 'worker@example.com',
      principalId: 'prn_worker',
      principalType: 'worker',
      sessionId: 'ses_worker',
    } satisfies AuthenticationSessionRow);

    await expect(authenticateSession('session-token')).resolves.toBeNull();
  });

  it('returns the authenticated user actor with the hashed token when the session is valid', async (): Promise<void> => {
    const config: ApiConfig = createApiTestConfig();
    mocks.getApiConfig.mockReturnValue(config);
    mocks.findAuthenticationSessionByTokenHash.mockResolvedValueOnce({
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      principalType: 'user',
      sessionId: 'ses_123',
    } satisfies AuthenticationSessionRow);

    await expect(authenticateSession('session-token')).resolves.toEqual({
      authSession: {
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: null,
        principalId: 'prn_123',
      },
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      principalType: 'user',
      sessionId: 'ses_123',
      tokenHash: hashToken('session-token', config.sessionSecret),
    });
  });
});
