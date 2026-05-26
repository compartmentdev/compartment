import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { consumeSsoOidcFlow, findSsoOidcFlowByStateHash } from '../../src/queries/sso-oidc.query';
import type { readOidcCallbackClaims } from '../../src/services/sso-oidc/sso-oidc-client.adapter';
import {
  completeBrowserSsoLogin,
  findCliLoginAttemptIdForBrowserSsoCallback,
} from '../../src/services/sso-oidc/sso-oidc-login.service';

type ConsumeSsoOidcFlow = typeof consumeSsoOidcFlow;
type FindSsoOidcFlowByStateHash = typeof findSsoOidcFlowByStateHash;
type ReadOidcCallbackClaims = typeof readOidcCallbackClaims;

interface SsoOidcLoginServiceMocks {
  consumeSsoOidcFlow: Mock<ConsumeSsoOidcFlow>;
  createSsoOidcFlow: Mock;
  deleteStaleSsoOidcFlows: Mock;
  findSsoOidcFlowByStateHash: Mock<FindSsoOidcFlowByStateHash>;
  readOidcCallbackClaims: Mock<ReadOidcCallbackClaims>;
}

const mocks: SsoOidcLoginServiceMocks = vi.hoisted(
  (): SsoOidcLoginServiceMocks => ({
    consumeSsoOidcFlow: vi.fn<ConsumeSsoOidcFlow>(),
    createSsoOidcFlow: vi.fn(),
    deleteStaleSsoOidcFlows: vi.fn(),
    findSsoOidcFlowByStateHash: vi.fn<FindSsoOidcFlowByStateHash>(),
    readOidcCallbackClaims: vi.fn<ReadOidcCallbackClaims>(),
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
  '../../src/services/sso-oidc/sso-oidc-client.adapter',
  (): { buildOidcAuthorizationPlan: Mock; readOidcCallbackClaims: Mock<ReadOidcCallbackClaims> } => ({
    buildOidcAuthorizationPlan: vi.fn(),
    readOidcCallbackClaims: mocks.readOidcCallbackClaims,
  }),
);

describe('SSO OIDC login service', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it.each([
    ['duplicate code', 'code=oidc-code&code=attacker-code&state=sso-state'],
    ['duplicate state', 'code=oidc-code&state=sso-state&state=attacker-state'],
    ['duplicate error', 'error=access_denied&error=server_error&state=sso-state'],
    ['duplicate unknown key', 'code=oidc-code&state=sso-state&unknown=abc&unknown=def'],
    ['duplicate tenant key', 'code=oidc-code&state=sso-state&tenant=acme&tenant=other'],
    ['failure callback', 'error=access_denied&state=sso-state'],
    ['mixed code and error', 'code=oidc-code&state=sso-state&error=access_denied'],
    ['mixed code and error_description', 'code=oidc-code&state=sso-state&error_description=denied'],
    ['mixed code and error_uri', 'code=oidc-code&state=sso-state&error_uri=https%3A%2F%2Fidp.example%2Ferror'],
  ] as const)(
    'rejects %s before consuming the flow or exchanging an OIDC token',
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
    ['duplicate state', 'code=oidc-code&state=sso-state&state=attacker-state'],
    ['duplicate unknown key', 'code=oidc-code&state=sso-state&unknown=abc&unknown=def'],
    ['duplicate tenant key', 'code=oidc-code&state=sso-state&tenant=acme&tenant=other'],
    ['mixed code and error', 'code=oidc-code&state=sso-state&error=access_denied'],
  ] as const)(
    'does not resolve a CLI login attempt from an invalid browser SSO callback with %s',
    async (_caseName: string, query: string): Promise<void> => {
      await expect(findCliLoginAttemptIdForBrowserSsoCallback(createSsoCallbackUrl(query))).resolves.toBeUndefined();

      expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
    },
  );
});

function createSsoCallbackUrl(query: string): URL {
  return new URL(`https://compartment.localhost/login/sso/callback?${query}`);
}
