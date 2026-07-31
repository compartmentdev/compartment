import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import { findGitProviderBootstrapStateById } from '../../queries/git-provider-bootstrap-state.query';
import type {
  GitProviderBootstrapStateRow,
  GitProviderRegistrationRow,
} from '../../queries/git-provider-registration.query.types';
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
  const state: GitProviderBootstrapStateRow | undefined = await readPendingGitHubBootstrapState(registration);
  if (state === undefined) {
    return false;
  }
  if (state.appSlug === null) {
    return true;
  }
  if (!hasPendingGitHubAppCredentials(state)) {
    return false;
  }

  try {
    await assertGitHubAppStillExists({
      appId: state.appId!,
      privateKeyPem: readPendingGitHubAppPrivateKey(state),
      providerHost: registration.providerHost,
    });
    return true;
  } catch (error) {
    return shouldKeepPendingGitHubBootstrapOnValidationError(error instanceof Error ? error : undefined);
  }
}

async function readPendingGitHubBootstrapState(
  registration: GitProviderRegistrationRow,
): Promise<GitProviderBootstrapStateRow | undefined> {
  if (registration.bootstrapStateId === null) return undefined;
  return await findGitProviderBootstrapStateById({
    bootstrapStateId: registration.bootstrapStateId,
    organizationId: registration.organizationId,
  });
}

function hasActivePendingGitHubBootstrap(
  pendingRegistration: GitProviderRegistrationRow | undefined,
  now: Date,
): pendingRegistration is GitProviderRegistrationRow {
  const pendingExpiresAt: Date | null | undefined = pendingRegistration?.pendingExpiresAt;
  return pendingRegistration?.bootstrapStateId != null && pendingExpiresAt != null && pendingExpiresAt > now;
}

function hasPendingGitHubAppCredentials(state: GitProviderBootstrapStateRow): boolean {
  return state.appId !== null && state.privateKeyPemCiphertext !== null && state.privateKeyPemEncryptionKeyId !== null;
}

function readPendingGitHubAppPrivateKey(state: GitProviderBootstrapStateRow): string {
  return decryptVariableValueFromStorage(
    state.privateKeyPemCiphertext!,
    state.privateKeyPemEncryptionKeyId!,
    getApiConfig().variablesMasterKey,
  );
}

function shouldKeepPendingGitHubBootstrapOnValidationError(error: Error | undefined): boolean {
  if (isGitHubAppAuthenticationFailure(error)) {
    return false;
  }

  return isGitHubRequestFailure(error) || isGitHubTransportFailure(error);
}
