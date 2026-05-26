import { hasText } from '@compartment/utils';
import { browserLoginSsoCallbackPathname } from '../../browser-public-paths';
import { createInvalidSsoLoginError } from '../../errors/api-business-error';
import { createId, hashToken } from '../../lib/tokens';
import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import {
  consumeSsoOidcFlow,
  createSsoOidcFlow,
  deleteStaleSsoOidcFlows,
  findSsoOidcFlowByStateHash,
} from '../../queries/sso-oidc.query';
import type { SsoOidcFlowRow, SsoOidcProviderRow } from '../../queries/sso-oidc.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import { buildRuntimePublicSettings } from '../public-hosts.service';
import { buildOidcAuthorizationPlan, readOidcCallbackClaims } from './sso-oidc-client.adapter';
import type { OidcAuthorizationPlan, OidcCallbackInput, OidcIdentityClaims } from './sso-oidc-client.adapter.types';
import { completeCliBrowserSsoLogin, issueBrowserSsoLoginResult } from './sso-oidc-login-completion.service';
import {
  readRequiredSsoOidcSuccessCallbackState,
  readSsoOidcCallbackStateForFailureHandling,
} from './sso-oidc-callback.service';
import { resolveSsoOidcLoginSession } from './sso-oidc-login-resolution.service';
import type {
  BrowserSsoFlowTarget,
  CompleteSsoOidcLoginResult,
  StartBrowserSsoLoginInput,
} from './sso-oidc.service.types';
import { requireSsoOidcProviderById, resolveBrowserSsoStartInput } from './sso-oidc-login.service.helpers';

const ssoOidcFlowTtlMs: number = 10 * 60 * 1000;
const ssoOidcCallbackPath: string = browserLoginSsoCallbackPathname;

export async function startBrowserSsoLogin(input: StartBrowserSsoLoginInput): Promise<string> {
  const { flowTarget, provider } = await resolveBrowserSsoStartInput(input);
  const redirectUri: string = buildSsoOidcRedirectUri();
  const authorization: OidcAuthorizationPlan = await buildOidcAuthorizationPlan({
    clientId: provider.clientId,
    clientSecret: decryptSsoOidcProviderSecret(provider),
    issuerUrl: provider.issuerUrl,
    redirectUri,
    scope: provider.scope,
  });

  await persistSsoOidcFlow(flowTarget, provider, authorization, input.cliLoginAttemptId ?? null);

  return authorization.authorizationUrl;
}

export async function completeBrowserSsoLogin(currentUrl: URL): Promise<CompleteSsoOidcLoginResult> {
  const flow: SsoOidcFlowRow = await consumeCallbackFlow(readRequiredSsoOidcSuccessCallbackState(currentUrl));
  const provider: SsoOidcProviderRow = await requireSsoOidcProviderById(flow.providerId);
  const claims: OidcIdentityClaims = await readOidcCallbackClaims(buildOidcCallbackInput(currentUrl, flow, provider));
  const { principal, session } = await resolveSsoOidcLoginSession({ claims, provider });

  if (flow.cliLoginAttemptId !== null) {
    return await completeCliBrowserSsoLogin(flow, principal, session);
  }

  return await issueBrowserSsoLoginResult(flow, principal, session);
}

export async function findCliLoginAttemptIdForBrowserSsoCallback(currentUrl: URL): Promise<string | undefined> {
  const state: string | null = readSsoOidcCallbackStateForFailureHandling(currentUrl);
  if (!hasText(state)) {
    return undefined;
  }

  const flow: SsoOidcFlowRow | undefined = await findSsoOidcFlowByStateHash(hashSsoOidcState(state));
  return flow?.cliLoginAttemptId ?? undefined;
}

function buildOidcCallbackInput(
  currentUrl: URL,
  flow: SsoOidcFlowRow,
  provider: SsoOidcProviderRow,
): OidcCallbackInput {
  return {
    clientId: provider.clientId,
    clientSecret: decryptSsoOidcProviderSecret(provider),
    currentUrl,
    expectedNonce: flow.nonce,
    expectedState: flow.oidcState,
    identityVerification: provider.identityVerification,
    issuerUrl: provider.issuerUrl,
    pkceCodeVerifier: flow.pkceCodeVerifier,
    redirectUri: buildSsoOidcRedirectUri(),
    scope: provider.scope,
  };
}

async function consumeCallbackFlow(state: string): Promise<SsoOidcFlowRow> {
  const flow: SsoOidcFlowRow | undefined = await findSsoOidcFlowByStateHash(hashSsoOidcState(state));
  const consumedAt: Date = new Date();
  if (flow === undefined || flow.expiresAt <= consumedAt || flow.consumedAt !== null) {
    throw createInvalidSsoLoginError();
  }

  if (!(await consumeSsoOidcFlow(flow.id, consumedAt))) {
    throw createInvalidSsoLoginError();
  }

  return flow;
}

function buildSsoOidcRedirectUri(): string {
  return new URL(ssoOidcCallbackPath, `${buildRuntimePublicSettings(getApiConfig()).compartmentUrl}/`).toString();
}

function decryptSsoOidcProviderSecret(provider: SsoOidcProviderRow): string {
  return decryptVariableValueFromStorage(
    provider.clientSecretCiphertext,
    provider.clientSecretEncryptionKeyId,
    getApiConfig().variablesMasterKey,
  );
}

async function persistSsoOidcFlow(
  flowTarget: BrowserSsoFlowTarget,
  provider: SsoOidcProviderRow,
  authorization: OidcAuthorizationPlan,
  cliLoginAttemptId: string | null,
): Promise<void> {
  await deleteStaleSsoOidcFlows(new Date());
  await createSsoOidcFlow({
    cliLoginAttemptId,
    expiresAt: new Date(Date.now() + ssoOidcFlowTtlMs),
    flowHost: flowTarget?.host ?? null,
    flowPath: flowTarget?.path ?? null,
    flowState: flowTarget?.state ?? null,
    id: createId('sof'),
    nonce: authorization.nonce,
    oidcState: authorization.state,
    pkceCodeVerifier: authorization.pkceCodeVerifier,
    providerId: provider.id,
    stateHash: hashSsoOidcState(authorization.state),
  });
}

function hashSsoOidcState(state: string): string {
  return hashToken(state, getApiConfig().sessionSecret);
}
