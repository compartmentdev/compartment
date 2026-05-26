import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import type { Database } from '../../src/db/client';
import type { consumeSsoOidcFlow, findSsoOidcFlowByStateHash } from '../../src/queries/sso-oidc.query';
import type { SsoOidcFlowRow, SsoOidcProviderRow } from '../../src/queries/sso-oidc.query.types';
import { clearApiRuntime, configureApiRuntime } from '../../src/runtime/runtime';
import type { decryptVariableValueFromStorage } from '../../src/lib/variables-crypto';
import type { readOidcCallbackClaims } from '../../src/services/sso-oidc/sso-oidc-client.adapter';
import type { OidcCallbackInput } from '../../src/services/sso-oidc/sso-oidc-client.adapter.types';
import type {
  completeCliBrowserSsoLogin,
  issueBrowserSsoLoginResult,
} from '../../src/services/sso-oidc/sso-oidc-login-completion.service';
import type { resolveSsoOidcLoginSession } from '../../src/services/sso-oidc/sso-oidc-login-resolution.service';
import type { requireSsoOidcProviderById } from '../../src/services/sso-oidc/sso-oidc-login.service.helpers';
import {
  completeBrowserSsoLogin,
  findCliLoginAttemptIdForBrowserSsoCallback,
} from '../../src/services/sso-oidc/sso-oidc-login.service';
import type { BrowserSsoLoginResult } from '../../src/services/sso-oidc/sso-oidc.service.types';
import { createSsoOidcApiConfig } from './sso-oidc-login.service.fixtures';

type ConsumeSsoOidcFlow = typeof consumeSsoOidcFlow;
type CompleteCliBrowserSsoLogin = typeof completeCliBrowserSsoLogin;
type DecryptVariableValueFromStorage = typeof decryptVariableValueFromStorage;
type FindSsoOidcFlowByStateHash = typeof findSsoOidcFlowByStateHash;
type IssueBrowserSsoLoginResult = typeof issueBrowserSsoLoginResult;
type ReadOidcCallbackClaims = typeof readOidcCallbackClaims;
type RequireSsoOidcProviderById = typeof requireSsoOidcProviderById;
type ResolveSsoOidcLoginSession = typeof resolveSsoOidcLoginSession;

interface SsoOidcLoginServiceMocks {
  completeCliBrowserSsoLogin: Mock<CompleteCliBrowserSsoLogin>;
  consumeSsoOidcFlow: Mock<ConsumeSsoOidcFlow>;
  createSsoOidcFlow: Mock;
  deleteStaleSsoOidcFlows: Mock;
  decryptVariableValueFromStorage: Mock<DecryptVariableValueFromStorage>;
  findSsoOidcFlowByStateHash: Mock<FindSsoOidcFlowByStateHash>;
  issueBrowserSsoLoginResult: Mock<IssueBrowserSsoLoginResult>;
  readOidcCallbackClaims: Mock<ReadOidcCallbackClaims>;
  requireSsoOidcProviderById: Mock<RequireSsoOidcProviderById>;
  resolveBrowserSsoStartInput: Mock;
  resolveSsoOidcLoginSession: Mock<ResolveSsoOidcLoginSession>;
}

const mocks: SsoOidcLoginServiceMocks = vi.hoisted(
  (): SsoOidcLoginServiceMocks => ({
    completeCliBrowserSsoLogin: vi.fn<CompleteCliBrowserSsoLogin>(),
    consumeSsoOidcFlow: vi.fn<ConsumeSsoOidcFlow>(),
    createSsoOidcFlow: vi.fn(),
    deleteStaleSsoOidcFlows: vi.fn(),
    decryptVariableValueFromStorage: vi.fn<DecryptVariableValueFromStorage>(),
    findSsoOidcFlowByStateHash: vi.fn<FindSsoOidcFlowByStateHash>(),
    issueBrowserSsoLoginResult: vi.fn<IssueBrowserSsoLoginResult>(),
    readOidcCallbackClaims: vi.fn<ReadOidcCallbackClaims>(),
    requireSsoOidcProviderById: vi.fn<RequireSsoOidcProviderById>(),
    resolveBrowserSsoStartInput: vi.fn(),
    resolveSsoOidcLoginSession: vi.fn<ResolveSsoOidcLoginSession>(),
  }),
);

vi.mock(
  '../../src/queries/sso-oidc.query',
  (): Record<string, Mock> => ({
    consumeSsoOidcFlow: mocks.consumeSsoOidcFlow,
    createSsoOidcFlow: mocks.createSsoOidcFlow,
    deleteStaleSsoOidcFlows: mocks.deleteStaleSsoOidcFlows,
    findSsoOidcFlowByStateHash: mocks.findSsoOidcFlowByStateHash,
  }),
);

vi.mock(
  '../../src/lib/variables-crypto',
  (): { decryptVariableValueFromStorage: Mock<DecryptVariableValueFromStorage> } => ({
    decryptVariableValueFromStorage: mocks.decryptVariableValueFromStorage,
  }),
);

vi.mock(
  '../../src/services/sso-oidc/sso-oidc-client.adapter',
  (): { buildOidcAuthorizationPlan: Mock; readOidcCallbackClaims: Mock<ReadOidcCallbackClaims> } => ({
    buildOidcAuthorizationPlan: vi.fn(),
    readOidcCallbackClaims: mocks.readOidcCallbackClaims,
  }),
);

vi.mock(
  '../../src/services/sso-oidc/sso-oidc-login-completion.service',
  (): {
    completeCliBrowserSsoLogin: Mock<CompleteCliBrowserSsoLogin>;
    issueBrowserSsoLoginResult: Mock<IssueBrowserSsoLoginResult>;
  } => ({
    completeCliBrowserSsoLogin: mocks.completeCliBrowserSsoLogin,
    issueBrowserSsoLoginResult: mocks.issueBrowserSsoLoginResult,
  }),
);

vi.mock(
  '../../src/services/sso-oidc/sso-oidc-login-resolution.service',
  (): { resolveSsoOidcLoginSession: Mock<ResolveSsoOidcLoginSession> } => ({
    resolveSsoOidcLoginSession: mocks.resolveSsoOidcLoginSession,
  }),
);

vi.mock(
  '../../src/services/sso-oidc/sso-oidc-login.service.helpers',
  (): {
    requireSsoOidcProviderById: Mock<RequireSsoOidcProviderById>;
    resolveBrowserSsoStartInput: Mock;
  } => ({
    requireSsoOidcProviderById: mocks.requireSsoOidcProviderById,
    resolveBrowserSsoStartInput: mocks.resolveBrowserSsoStartInput,
  }),
);

describe('SSO OIDC login service', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
    configureApiRuntime({
      config: createSsoOidcApiConfig(),
      db: {} as Database,
    });
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  it.each([
    ['code', 'code=oidc-code&code=attacker-code&state=sso-state'],
    ['state', 'code=oidc-code&state=sso-state&state=attacker-state'],
    ['error', 'error=access_denied&error=server_error&state=sso-state'],
    ['unknown', 'code=oidc-code&state=sso-state&unknown=abc&unknown=def'],
    ['tenant', 'code=oidc-code&state=sso-state&tenant=acme&tenant=other'],
  ] as const)(
    'rejects browser SSO callbacks with a duplicate %s query parameter before consuming the flow',
    async (_queryName: string, query: string): Promise<void> => {
      await expect(completeBrowserSsoLogin(createSsoCallbackUrl(query))).rejects.toMatchObject({
        code: 'invalid_sso_login',
      });

      expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
      expect(mocks.consumeSsoOidcFlow).not.toHaveBeenCalled();
      expect(mocks.readOidcCallbackClaims).not.toHaveBeenCalled();
      expect(mocks.issueBrowserSsoLoginResult).not.toHaveBeenCalled();
      expect(mocks.completeCliBrowserSsoLogin).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['error only', 'error=access_denied'],
    ['error and state', 'error=access_denied&state=sso-state'],
    ['error description', 'error=access_denied&state=sso-state&error_description=denied'],
    ['error URI', 'error=access_denied&state=sso-state&error_uri=https%3A%2F%2Fidp.example%2Ferror'],
  ] as const)(
    'rejects failure SSO callbacks with %s before consuming the flow',
    async (_caseName: string, query: string): Promise<void> => {
      await expect(completeBrowserSsoLogin(createSsoCallbackUrl(query))).rejects.toMatchObject({
        code: 'invalid_sso_login',
      });

      expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
      expect(mocks.consumeSsoOidcFlow).not.toHaveBeenCalled();
      expect(mocks.readOidcCallbackClaims).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['success callback with unknown key', 'code=oidc-code&state=sso-state&unknown=abc'],
    ['success callback with tenant key', 'code=oidc-code&state=sso-state&tenant=acme'],
    ['failure callback with tenant key', 'error=access_denied&state=sso-state&tenant=acme'],
  ] as const)(
    'rejects SSO callbacks with extra query parameters in a %s before consuming the flow',
    async (_caseName: string, query: string): Promise<void> => {
      await expect(completeBrowserSsoLogin(createSsoCallbackUrl(query))).rejects.toMatchObject({
        code: 'invalid_sso_login',
      });

      expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
      expect(mocks.consumeSsoOidcFlow).not.toHaveBeenCalled();
      expect(mocks.readOidcCallbackClaims).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['error', 'code=oidc-code&state=sso-state&error=access_denied'],
    ['error_description', 'code=oidc-code&state=sso-state&error_description=denied'],
    ['error_uri', 'code=oidc-code&state=sso-state&error_uri=https%3A%2F%2Fidp.example%2Ferror'],
  ] as const)(
    'rejects mixed success and failure SSO callbacks with %s before consuming the flow',
    async (_queryName: string, query: string): Promise<void> => {
      await expect(completeBrowserSsoLogin(createSsoCallbackUrl(query))).rejects.toMatchObject({
        code: 'invalid_sso_login',
      });

      expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
      expect(mocks.consumeSsoOidcFlow).not.toHaveBeenCalled();
      expect(mocks.readOidcCallbackClaims).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['duplicate state', 'code=oidc-code&state=sso-state&state=attacker-state'],
    ['duplicate unknown key', 'code=oidc-code&state=sso-state&unknown=abc&unknown=def'],
    ['extra tenant key', 'error=access_denied&state=sso-state&tenant=acme'],
    ['mixed code and error', 'code=oidc-code&state=sso-state&error=access_denied'],
  ] as const)(
    'does not resolve a CLI login attempt from an invalid browser SSO callback with %s',
    async (_caseName: string, query: string): Promise<void> => {
      await expect(findCliLoginAttemptIdForBrowserSsoCallback(createSsoCallbackUrl(query))).resolves.toBeUndefined();

      expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
    },
  );

  it('completes a valid success callback', async (): Promise<void> => {
    const flow: SsoOidcFlowRow = createSsoOidcFlow();
    const provider: SsoOidcProviderRow = createSsoOidcProvider();
    const result: BrowserSsoLoginResult = createBrowserSsoLoginResult();
    mocks.findSsoOidcFlowByStateHash.mockResolvedValueOnce(flow);
    mocks.consumeSsoOidcFlow.mockResolvedValueOnce(true);
    mocks.requireSsoOidcProviderById.mockResolvedValueOnce(provider);
    mocks.decryptVariableValueFromStorage.mockReturnValueOnce('client-secret');
    mocks.readOidcCallbackClaims.mockResolvedValueOnce({
      email: 'admin@example.com',
      emailVerified: true,
      issuer: 'https://accounts.google.com',
      subject: 'google-subject',
    });
    mocks.resolveSsoOidcLoginSession.mockResolvedValueOnce({
      principal: {
        principalEmail: 'admin@example.com',
        principalId: 'prn_123',
        principalType: 'user',
      },
      session: {
        authMethodKind: 'oidc',
        expiresAt: new Date('2099-04-21T10:20:00.000Z'),
        oidcProviderId: provider.id,
        organizationId: provider.organizationId,
        sessionId: 'ses_123',
        sessionToken: 'session-token',
        tokenHash: 'session-token-hash',
      },
    });
    mocks.issueBrowserSsoLoginResult.mockResolvedValueOnce(result);

    const currentUrl: URL = createSsoCallbackUrl('code=oidc-code&state=sso-state');

    await expect(completeBrowserSsoLogin(currentUrl)).resolves.toBe(result);

    expect(mocks.consumeSsoOidcFlow).toHaveBeenCalledWith(flow.id, expect.any(Date));
    expect(mocks.readOidcCallbackClaims).toHaveBeenCalledTimes(1);
    const oidcCallbackClaimsInput: OidcCallbackInput | undefined = mocks.readOidcCallbackClaims.mock.calls[0]?.[0];
    expect(oidcCallbackClaimsInput?.currentUrl.href).toBe(currentUrl.href);
    expect(oidcCallbackClaimsInput?.expectedState).toBe(flow.oidcState);
    expect(mocks.issueBrowserSsoLoginResult).toHaveBeenCalledWith(
      flow,
      {
        principalEmail: 'admin@example.com',
        principalId: 'prn_123',
        principalType: 'user',
      },
      expect.objectContaining({ sessionId: 'ses_123' }),
    );
  });

  it('resolves a CLI login attempt from a valid failure callback state', async (): Promise<void> => {
    mocks.findSsoOidcFlowByStateHash.mockResolvedValueOnce({
      ...createSsoOidcFlow(),
      cliLoginAttemptId: 'cla_123',
    });

    await expect(
      findCliLoginAttemptIdForBrowserSsoCallback(createSsoCallbackUrl('error=access_denied&state=sso-state')),
    ).resolves.toBe('cla_123');

    expect(mocks.findSsoOidcFlowByStateHash).toHaveBeenCalledTimes(1);
  });
});

function createSsoCallbackUrl(query: string): URL {
  return new URL(`https://compartment.localhost/login/sso/callback?${query}`);
}

function createSsoOidcFlow(): SsoOidcFlowRow {
  return {
    cliLoginAttemptId: null,
    consumedAt: null,
    createdAt: new Date('2099-04-21T10:00:00.000Z'),
    expiresAt: new Date('2099-04-21T10:10:00.000Z'),
    flowHost: null,
    flowPath: null,
    flowState: null,
    id: 'sof_123',
    nonce: 'oidc-nonce',
    oidcState: 'sso-state',
    pkceCodeVerifier: 'pkce-verifier',
    providerId: 'sop_123',
    stateHash: 'state-hash',
  };
}

function createSsoOidcProvider(): SsoOidcProviderRow {
  return {
    buttonText: 'Continue with SSO',
    clientId: 'client-id',
    clientSecretCiphertext: 'encrypted-client-secret',
    clientSecretEncryptionKeyId: 'master',
    createdAt: new Date('2099-04-21T10:00:00.000Z'),
    displayName: 'Google',
    id: 'sop_123',
    identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
    issuerUrl: 'https://accounts.google.com',
    key: 'google',
    organizationId: 'org_123',
    preset: 'google',
    provisioning: buildDisabledSsoOidcProvisioningPolicy(),
    scope: 'openid email profile',
    updatedAt: new Date('2099-04-21T10:00:00.000Z'),
  };
}

function createBrowserSsoLoginResult(): BrowserSsoLoginResult {
  return {
    authSession: {
      authMethodKind: 'oidc',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    },
    flowTarget: null,
    kind: 'browser_session',
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    sessionExpiresAt: new Date('2099-04-21T10:20:00.000Z'),
    sessionId: 'ses_123',
    sessionToken: 'session-token',
  };
}
