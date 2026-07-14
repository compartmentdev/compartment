import { hasText } from '@compartment/utils';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { assertGitHubAppStillExists, readGitHubAppInstallation } from './github-app-client.adapter';
import type { GitHubAppInstallation } from './github-app-client.adapter.types';
import {
  isGitHubAppAuthenticationFailure,
  isGitHubRepositoryAccessFailure,
  isGitHubRequestFailure,
  isGitHubTransportFailure,
} from './github-app-http.adapter';
import type { GitProviderAccess, GitProviderCredential } from './git-source-provider.types';

export type ActiveGitHubRegistrationState = 'app_missing' | 'installation_missing' | 'valid';

interface ActiveGitHubRegistrationAuth {
  appId: string;
  installationId: string;
  privateKeyPem: string;
}

export async function readActiveGitHubRegistrationState(
  access: GitProviderAccess,
): Promise<ActiveGitHubRegistrationState> {
  const registration: GitProviderRegistrationRow = access.registration;
  const auth: ActiveGitHubRegistrationAuth | null = readActiveGitHubRegistrationAuth(access.credential);
  if (auth === null) {
    return 'app_missing';
  }
  const appState: ActiveGitHubRegistrationState = await readGitHubAppValidationState(registration, auth);
  if (appState !== 'valid') {
    return appState;
  }

  return await readGitHubInstallationValidationState(registration, auth);
}

async function readGitHubAppValidationState(
  registration: GitProviderRegistrationRow,
  auth: ActiveGitHubRegistrationAuth,
): Promise<ActiveGitHubRegistrationState> {
  try {
    await assertGitHubAppStillExists({
      appId: auth.appId,
      privateKeyPem: auth.privateKeyPem,
      providerHost: registration.providerHost,
    });
    return 'valid';
  } catch (error) {
    return readGitHubAppValidationFailureState(error instanceof Error ? error : undefined);
  }
}

async function readGitHubInstallationValidationState(
  registration: GitProviderRegistrationRow,
  auth: ActiveGitHubRegistrationAuth,
): Promise<ActiveGitHubRegistrationState> {
  if (!hasText(auth.installationId)) {
    return 'installation_missing';
  }
  try {
    const installation: GitHubAppInstallation = await readGitHubAppInstallation({
      appId: auth.appId,
      installationId: auth.installationId,
      privateKeyPem: auth.privateKeyPem,
      providerHost: registration.providerHost,
    });
    return installation.accountLogin.toLowerCase() === registration.repositoryOwner.toLowerCase()
      ? 'valid'
      : 'installation_missing';
  } catch (error) {
    return readGitHubInstallationValidationFailureState(error instanceof Error ? error : undefined);
  }
}

function readGitHubAppValidationFailureState(error: Error | undefined): ActiveGitHubRegistrationState {
  if (isGitHubAppAuthenticationFailure(error)) {
    return 'app_missing';
  }
  return readTransientGitHubValidationFailureState(error, 'GitHub App validation failed.');
}

function readGitHubInstallationValidationFailureState(error: Error | undefined): ActiveGitHubRegistrationState {
  if (isGitHubRepositoryAccessFailure(error) || isGitHubAppAuthenticationFailure(error)) {
    return 'installation_missing';
  }
  return readTransientGitHubValidationFailureState(error, 'GitHub App installation validation failed.');
}

function readTransientGitHubValidationFailureState(
  error: Error | undefined,
  fallbackMessage: string,
): ActiveGitHubRegistrationState {
  if (isGitHubRequestFailure(error) || isGitHubTransportFailure(error)) {
    return 'valid';
  }

  throw error ?? new Error(fallbackMessage);
}

function readActiveGitHubRegistrationAuth(credential: GitProviderCredential): ActiveGitHubRegistrationAuth | null {
  if (
    credential.kind !== 'github_app' ||
    !hasText(credential.appId) ||
    !hasText(credential.appSlug) ||
    !hasText(credential.installationId)
  ) {
    return null;
  }
  return {
    appId: credential.appId,
    installationId: credential.installationId,
    privateKeyPem: credential.privateKeyPem,
  };
}
