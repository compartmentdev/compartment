import { createGitSourceBootstrapInvalidError } from '../../errors/api-business-error';
import type {
  GitProviderBootstrapStateRow,
  GitProviderMutationTransaction,
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
} from '../../queries/git-provider-registration.query.types';
import { getApiConfig, getApiDatabase } from '../../runtime/runtime-access';
import { exchangeGitHubAppManifestCode } from './github-app-client.adapter';
import type { GitHubAppInstallation, GitHubManifestConversionResult } from './github-app-client.adapter.types';
import { buildGitHubAppInstallUrl } from './github-app-bootstrap.adapter';
import {
  buildClaimedGitHubBootstrapSetup,
  type ClaimedGitHubBootstrapSetup,
} from './git-source-bootstrap-completion.support';
import {
  buildGitHubProviderSetupReturnTo,
  failGitHubProviderBootstrap,
  finalizeGitHubProviderBootstrapSetup,
  verifyGitHubProviderBootstrapSetup,
} from './git-source-bootstrap-completion-finalization.service';
import { persistPendingGitHubProviderManifestExchange } from './git-source-bootstrap.persistence';
import { encryptGitHubManifestSecrets, type GitHubManifestSecrets } from './git-source-bootstrap.support';
import { requireGitProviderRegistration } from './git-source-bootstrap.read';
import {
  findGitProviderBootstrapStateByIdForPublicFlowWithExecutor,
  findGitProviderBootstrapStateByIdWithExecutor,
  findGitProviderBootstrapStateByNonceWithExecutor,
  lockGitProviderBootstrapStateMutationWithExecutor,
} from '../../queries/git-provider-bootstrap-state.query';
import { findGitProviderRegistrationByIdWithExecutor } from '../../queries/git-provider-registration.query';

export async function completeGitHubProviderBootstrapCallback(
  manifestCode: string,
  stateNonce: string,
): Promise<string> {
  const now: Date = new Date();
  const claimedState: GitProviderBootstrapStateRow = await claimGitHubProviderBootstrapCallbackTransaction(
    stateNonce,
    now,
  );
  const registration: GitProviderRegistrationRow = await requireGitProviderRegistration({
    organizationId: claimedState.organizationId,
    registrationId: claimedState.providerRegistrationId,
  });
  const exchanged: GitHubManifestConversionResult = await exchangeAndPersistGitHubProviderManifest(
    registration,
    manifestCode,
    now,
  );
  return buildGitHubAppInstallUrl(registration.providerHost, exchanged.appSlug, claimedState.id);
}

export async function completeGitHubProviderBootstrapSetup(
  bootstrapStateId: string,
  installationId: string,
): Promise<string | null> {
  const now: Date = new Date();
  const claimedSetup: ClaimedGitHubBootstrapSetup = await claimGitHubProviderBootstrapSetupTransaction(
    bootstrapStateId,
    now,
  );
  const installation: GitHubAppInstallation = await verifyGitHubProviderBootstrapSetup(
    claimedSetup,
    installationId,
    now,
  );
  await finalizeGitHubProviderBootstrapSetup(claimedSetup, installation, now);
  return buildGitHubProviderSetupReturnTo(claimedSetup, installation);
}

async function claimGitHubProviderBootstrapCallbackTransaction(
  stateNonce: string,
  now: Date,
): Promise<GitProviderBootstrapStateRow> {
  return await getApiDatabase().transaction(
    async (transaction: GitProviderMutationTransaction): Promise<GitProviderBootstrapStateRow> => {
      const state: GitProviderBootstrapStateRow = await requirePendingBootstrapStateByNonce(
        transaction,
        stateNonce,
        now,
      );
      await requirePendingBootstrapRegistration(transaction, state);
      if (state.appId !== null) {
        throw createGitSourceBootstrapInvalidError();
      }
      return state;
    },
  );
}

async function exchangeAndPersistGitHubProviderManifest(
  registration: GitProviderRegistrationRow,
  manifestCode: string,
  now: Date,
): Promise<GitHubManifestConversionResult> {
  const exchanged: GitHubManifestConversionResult = await exchangeGitHubProviderManifest(
    registration,
    registration.providerHost,
    manifestCode,
    now,
  );
  const encryptedSecrets: GitHubManifestSecrets = encryptGitHubManifestSecrets(
    exchanged.privateKeyPem,
    exchanged.webhookSecret,
    getApiConfig().variablesMasterKey,
  );
  await persistGitHubProviderManifestExchangeWithFailureCleanup(registration, exchanged, encryptedSecrets, now);

  return exchanged;
}

async function claimGitHubProviderBootstrapSetupTransaction(
  stateId: string,
  now: Date,
): Promise<ClaimedGitHubBootstrapSetup> {
  return await getApiDatabase().transaction(
    async (transaction: GitProviderMutationTransaction): Promise<ClaimedGitHubBootstrapSetup> => {
      const state: GitProviderBootstrapStateRow = await requirePendingBootstrapStateById(transaction, stateId, now);
      const registration: GitProviderRegistrationRow = await requirePendingBootstrapRegistration(transaction, state);
      return buildClaimedGitHubBootstrapSetup(state, registration);
    },
  );
}

async function requirePendingBootstrapStateByNonce(
  transaction: GitProviderMutationTransaction,
  stateNonce: string,
  now: Date,
): Promise<GitProviderBootstrapStateRow> {
  const state: GitProviderBootstrapStateRow | undefined = await findGitProviderBootstrapStateByNonceWithExecutor(
    transaction,
    stateNonce,
  );
  if (state === undefined) {
    throw createGitSourceBootstrapInvalidError();
  }
  return await lockAndRequirePendingBootstrapState(
    transaction,
    {
      bootstrapStateId: state.id,
      organizationId: state.organizationId,
    },
    now,
  );
}

async function requirePendingBootstrapStateById(
  transaction: GitProviderMutationTransaction,
  stateId: string,
  now: Date,
): Promise<GitProviderBootstrapStateRow> {
  const state: GitProviderBootstrapStateRow | undefined =
    await findGitProviderBootstrapStateByIdForPublicFlowWithExecutor(transaction, stateId);
  if (state === undefined) {
    throw createGitSourceBootstrapInvalidError();
  }
  return await lockAndRequirePendingBootstrapState(
    transaction,
    {
      bootstrapStateId: state.id,
      organizationId: state.organizationId,
    },
    now,
  );
}

async function lockAndRequirePendingBootstrapState(
  transaction: GitProviderMutationTransaction,
  input: Pick<GitProviderBootstrapStateRow, 'organizationId'> & { bootstrapStateId: string },
  now: Date,
): Promise<GitProviderBootstrapStateRow> {
  await lockGitProviderBootstrapStateMutationWithExecutor(transaction, input.bootstrapStateId);
  const state: GitProviderBootstrapStateRow | undefined = await findGitProviderBootstrapStateByIdWithExecutor(
    transaction,
    input,
  );
  if (state === undefined) {
    throw createGitSourceBootstrapInvalidError();
  }
  if (state.completedAt !== null || state.expiresAt <= now) {
    throw createGitSourceBootstrapInvalidError();
  }
  return state;
}

async function requirePendingBootstrapRegistration(
  transaction: GitProviderMutationTransaction,
  state: GitProviderBootstrapStateRow,
): Promise<GitProviderRegistrationRow> {
  const registration: GitProviderRegistrationRow | undefined = await findGitProviderRegistrationByIdWithExecutor(
    transaction,
    {
      organizationId: state.organizationId,
      registrationId: state.providerRegistrationId,
    },
  );
  if (registration?.status !== 'pending') {
    throw createGitSourceBootstrapInvalidError();
  }
  return registration;
}

async function exchangeGitHubProviderManifest(
  registration: GitProviderRegistrationRow,
  providerHost: string,
  manifestCode: string,
  now: Date,
): Promise<GitHubManifestConversionResult> {
  try {
    return await exchangeGitHubAppManifestCode({
      manifestCode,
      providerHost,
    });
  } catch (error) {
    await failGitHubProviderBootstrap(registration, null, now);
    throw error;
  }
}

async function persistGitHubProviderManifestExchangeWithFailureCleanup(
  registration: GitProviderRegistrationRow,
  exchanged: GitHubManifestConversionResult,
  encryptedSecrets: GitHubManifestSecrets,
  now: Date,
): Promise<void> {
  try {
    await getApiDatabase().transaction(async (transaction: GitProviderWriteExecutor): Promise<void> => {
      await persistPendingGitHubProviderManifestExchange(transaction, registration, exchanged, encryptedSecrets, now);
    });
  } catch (error) {
    await failGitHubProviderBootstrap(registration, null, now);
    throw error;
  }
}
