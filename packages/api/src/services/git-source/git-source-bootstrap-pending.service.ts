import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import { assertGitHubAppStillExists } from './github-app-client.adapter';
import {
  isGitHubAppAuthenticationFailure,
  isGitHubRequestFailure,
  isGitHubTransportFailure,
} from './github-app-http.adapter';

export async function readReusablePendingGitHubBootstrap(
  pendingRegistration: GitProviderRegistrationRow | undefined,
  now: Date,
): Promise<GitProviderRegistrationRow | null> {
  if (!hasActivePendingGitHubBootstrap(pendingRegistration, now)) {
    return null;
  }

  return (await isPendingGitHubBootstrapReusable(pendingRegistration)) ? pendingRegistration : null;
}

async function isPendingGitHubBootstrapReusable(registration: GitProviderRegistrationRow): Promise<boolean> {
  if (registration.appSlug === null) {
    return true;
  }
  if (!hasPendingGitHubAppCredentials(registration)) {
    return false;
  }

  try {
    await assertGitHubAppStillExists({
      appId: registration.appId!,
      privateKeyPem: readPendingGitHubAppPrivateKey(registration),
      providerHost: registration.providerHost,
    });
    return true;
  } catch (error) {
    return shouldKeepPendingGitHubBootstrapOnValidationError(error instanceof Error ? error : undefined);
  }
}

function hasActivePendingGitHubBootstrap(
  pendingRegistration: GitProviderRegistrationRow | undefined,
  now: Date,
): pendingRegistration is GitProviderRegistrationRow {
  const pendingExpiresAt: Date | null | undefined = pendingRegistration?.pendingExpiresAt;
  return pendingRegistration?.bootstrapStateId != null && pendingExpiresAt != null && pendingExpiresAt > now;
}

function hasPendingGitHubAppCredentials(registration: GitProviderRegistrationRow): boolean {
  return (
    registration.appId !== null &&
    registration.privateKeyPemCiphertext !== null &&
    registration.privateKeyPemEncryptionKeyId !== null
  );
}

function readPendingGitHubAppPrivateKey(registration: GitProviderRegistrationRow): string {
  return decryptVariableValueFromStorage(
    registration.privateKeyPemCiphertext!,
    registration.privateKeyPemEncryptionKeyId!,
    getApiConfig().variablesMasterKey,
  );
}

function shouldKeepPendingGitHubBootstrapOnValidationError(error: Error | undefined): boolean {
  if (isGitHubAppAuthenticationFailure(error)) {
    return false;
  }

  return isGitHubRequestFailure(error) || isGitHubTransportFailure(error);
}
