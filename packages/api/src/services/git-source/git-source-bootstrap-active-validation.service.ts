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
import { readGitHubRegistrationPrivateKey } from './github-provider.adapter';

export type ActiveGitHubRegistrationState = 'app_missing' | 'installation_missing' | 'valid';

interface ActiveGitHubRegistrationAuth {
  appId: string;
  privateKeyPem: string;
}

export async function readActiveGitHubRegistrationState(
  registration: GitProviderRegistrationRow,
): Promise<ActiveGitHubRegistrationState> {
  const auth: ActiveGitHubRegistrationAuth | null = readActiveGitHubRegistrationAuth(registration);
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
  if (!hasText(registration.installationId)) {
    return 'installation_missing';
  }
  try {
    const installation: GitHubAppInstallation = await readGitHubAppInstallation({
      appId: auth.appId,
      installationId: registration.installationId,
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

function readActiveGitHubRegistrationAuth(
  registration: GitProviderRegistrationRow,
): ActiveGitHubRegistrationAuth | null {
  if (!hasActiveGitHubAppMaterial(registration)) {
    return null;
  }
  return {
    appId: registration.appId,
    privateKeyPem: readGitHubRegistrationPrivateKey(registration),
  };
}

function hasActiveGitHubAppMaterial(
  registration: GitProviderRegistrationRow,
): registration is GitProviderRegistrationRow & { appId: string; appSlug: string } {
  return (
    hasText(registration.appId) &&
    hasText(registration.appSlug) &&
    hasText(registration.privateKeyPemCiphertext) &&
    hasText(registration.privateKeyPemEncryptionKeyId)
  );
}
