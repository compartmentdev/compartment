import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { consumeSsoOidcFlow, findSsoOidcFlowByStateHash } from '../../src/queries/sso-oidc.query';
import {
  completeBrowserSsoLogin,
  findCliLoginAttemptIdForBrowserSsoCallback,
} from '../../src/services/sso-oidc/sso-oidc-login.service';

type ConsumeSsoOidcFlow = typeof consumeSsoOidcFlow;
type FindSsoOidcFlowByStateHash = typeof findSsoOidcFlowByStateHash;

interface SsoOidcLoginServiceMocks {
  consumeSsoOidcFlow: Mock<ConsumeSsoOidcFlow>;
  createSsoOidcFlow: Mock;
  deleteStaleSsoOidcFlows: Mock;
  findSsoOidcFlowByStateHash: Mock<FindSsoOidcFlowByStateHash>;
}

const mocks: SsoOidcLoginServiceMocks = vi.hoisted(
  (): SsoOidcLoginServiceMocks => ({
    consumeSsoOidcFlow: vi.fn<ConsumeSsoOidcFlow>(),
    createSsoOidcFlow: vi.fn(),
    deleteStaleSsoOidcFlows: vi.fn(),
    findSsoOidcFlowByStateHash: vi.fn<FindSsoOidcFlowByStateHash>(),
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

describe('SSO OIDC login service', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it.each([
    ['code', 'code=oidc-code&code=attacker-code&state=sso-state'],
    ['state', 'code=oidc-code&state=sso-state&state=attacker-state'],
  ] as const)(
    'rejects browser SSO callbacks with a duplicate %s query parameter before consuming the flow',
    async (_queryName: string, query: string): Promise<void> => {
      await expect(completeBrowserSsoLogin(createSsoCallbackUrl(query))).rejects.toMatchObject({
        code: 'invalid_sso_login',
      });

      expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
      expect(mocks.consumeSsoOidcFlow).not.toHaveBeenCalled();
    },
  );

  it('does not resolve a CLI login attempt from a duplicate browser SSO callback state', async (): Promise<void> => {
    await expect(
      findCliLoginAttemptIdForBrowserSsoCallback(
        createSsoCallbackUrl('code=oidc-code&state=sso-state&state=attacker-state'),
      ),
    ).resolves.toBeUndefined();

    expect(mocks.findSsoOidcFlowByStateHash).not.toHaveBeenCalled();
  });
});

function createSsoCallbackUrl(query: string): URL {
  return new URL(`https://compartment.localhost/login/sso/callback?${query}`);
}
