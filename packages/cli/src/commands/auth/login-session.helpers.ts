import type { ActivateResponse, LoginResponse } from '@compartment/contracts';
import { resolveOrganizationBySlug, selectLoginOrganization } from '../../services/context.service';
import { findConfiguredRemote } from '../../services/remote-context.service';
import { buildLoggedInConfig } from '../../store/config.mutations';
import { writeCliConfig } from '../../store/config.store';
import type { CliConfig, CliOrganizationConfig, CliRemoteConfig } from '../../store/config.types';
import type { ResolvedLoginRemote } from './auth-remote.command';
import { requireAuthSessionToken } from './session-token.guard';

type AuthSessionResponse = ActivateResponse | LoginResponse;

interface PersistResolvedLoginSessionInput {
  config: CliConfig;
  firstDeployOnboardingSessionId?: string | undefined;
  remote: ResolvedLoginRemote;
  response: AuthSessionResponse;
  selectedOrganizationSlug?: string | undefined;
}

export interface PersistResolvedLoginSessionResult {
  config: CliConfig;
  currentOrganization?: CliOrganizationConfig | undefined;
}

export async function persistResolvedLoginSession(
  input: PersistResolvedLoginSessionInput,
): Promise<PersistResolvedLoginSessionResult> {
  const currentOrganization: CliOrganizationConfig | undefined = resolveCurrentOrganization(input);
  const sessionToken: string = requireAuthSessionToken(
    input.response,
    `Missing session token for ${input.remote.remoteName} login session.`,
  );

  const nextConfig: CliConfig = buildLoggedInConfig(
    input.config,
    input.remote.remoteName,
    input.remote.apiUrl,
    input.response.principal.email,
    sessionToken,
    currentOrganization,
    input.firstDeployOnboardingSessionId,
  );
  await writeCliConfig(nextConfig);

  return {
    config: nextConfig,
    currentOrganization,
  };
}

function resolveCurrentOrganization(input: PersistResolvedLoginSessionInput): CliOrganizationConfig | undefined {
  if (input.selectedOrganizationSlug !== undefined) {
    return resolveOrganizationBySlug(input.response.organizations, input.selectedOrganizationSlug);
  }

  const existingRemote: CliRemoteConfig | undefined = findConfiguredRemote(input.config, input.remote.remoteName);
  return selectLoginOrganization(
    input.response.organizations,
    existingRemote?.apiUrl === input.remote.apiUrl ? existingRemote.currentOrganization : undefined,
  );
}
