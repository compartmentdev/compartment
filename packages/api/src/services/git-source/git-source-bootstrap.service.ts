import {
  compartmentGitHubProviderCallbackPathname,
  compartmentGitHubProviderSetupPathname,
} from '@compartment/contracts';
import {
  createGitSourceBootstrapInvalidError,
  createGitSourceRegistrationFailedError,
} from '../../errors/api-business-error';
import { isUniqueConstraintError } from '../../queries/query-error';
import {
  findGitProviderBootstrapStateById,
  findGitProviderBootstrapStateByIdForPublicFlow,
} from '../../queries/git-provider-bootstrap-state.query';
import { findAnyPendingGitProviderRegistration } from '../../queries/git-provider-registration-bootstrap.query';
import type {
  GitProviderBootstrapStateRow,
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
} from '../../queries/git-provider-registration.query.types';
import { getApiConfig, getApiDatabase } from '../../runtime/runtime-access';
import { buildRuntimePublicSettings } from '../public-hosts.service';
import { isTrustedGitHubProviderHost } from '../outbound-http.service';
import { readGitHubAppManifestPlan, buildGitHubAppInstallUrl } from './github-app-bootstrap.adapter';
import { failPendingGitHubBootstrap, persistPendingGitHubBootstrap } from './git-source-bootstrap.persistence';
import {
  buildPendingGitHubBootstrapMaterial,
  type PendingGitHubBootstrapMaterial,
} from './git-source-bootstrap.support';
import {
  buildPendingBootstrapResponse,
  readGitHubBootstrapViewForState,
  readPendingGitHubBootstrapView,
  requireBootstrapPageState,
  requireGitProviderRegistration,
} from './git-source-bootstrap.read';
import { readActiveGitHubBootstrapView } from './git-source-bootstrap-active.service';
import { readReusablePendingGitHubBootstrap } from './git-source-bootstrap-pending.service';
import type {
  GitHubProviderBootstrapPage,
  GitHubProviderBootstrapView,
  ReadGitHubProviderBootstrapPageInput,
  ReadGitHubProviderBootstrapStatusInput,
  StartGitHubProviderBootstrapInput,
} from './git-source.service.types';

const gitHubBootstrapTtlMs: number = 10 * 60 * 1000;
const gitHubCallbackPathname: string = compartmentGitHubProviderCallbackPathname;
const gitHubSetupPathname: string = compartmentGitHubProviderSetupPathname;

interface GitHubManifestPagePlan {
  formActionUrl: string;
  manifestJson: string;
}

interface PendingGitHubBootstrapLookup {
  pendingRegistration: GitProviderRegistrationRow | undefined;
  reusableRegistration: GitProviderRegistrationRow | null;
}

export async function startGitHubProviderBootstrap(
  input: StartGitHubProviderBootstrapInput,
): Promise<GitHubProviderBootstrapView> {
  assertTrustedGitHubProviderHost(input.providerHost);
  const now: Date = new Date();
  const activeView: GitHubProviderBootstrapView | null = await readCurrentActiveGitHubBootstrapView(
    input,
    now,
    async (): Promise<GitHubProviderBootstrapView> => await recoverPendingBootstrapAfterRace(input, now),
  );
  if (activeView !== null) {
    return activeView;
  }
  const lookup: PendingGitHubBootstrapLookup = await readPendingGitHubBootstrapLookup(input, now);
  if (lookup.reusableRegistration !== null) {
    return await readPendingGitHubBootstrapView(input.compartmentUrl, lookup.reusableRegistration);
  }
  return await createPendingGitHubBootstrap(
    input,
    now,
    lookup.pendingRegistration,
    lookup.pendingRegistration !== undefined,
  );
}

export async function readGitHubProviderBootstrapStatus(
  input: ReadGitHubProviderBootstrapStatusInput,
): Promise<GitHubProviderBootstrapView> {
  const state: GitProviderBootstrapStateRow | undefined = await findGitProviderBootstrapStateById({
    bootstrapStateId: input.bootstrapStateId,
    organizationId: input.organizationId,
  });
  if (state === undefined) {
    throw createGitSourceBootstrapInvalidError();
  }
  assertBootstrapPageOwner(state, input.actor.principalId);

  return await readGitHubBootstrapViewForState(readCompartmentUrl(), state);
}

export async function readGitHubProviderBootstrapPage(
  input: ReadGitHubProviderBootstrapPageInput,
): Promise<GitHubProviderBootstrapPage> {
  const state: GitProviderBootstrapStateRow = requireBootstrapPageState(
    await findGitProviderBootstrapStateByIdForPublicFlow(input.bootstrapStateId),
  );
  assertBootstrapPageOwner(state, input.actorPrincipalId);
  const registration: GitProviderRegistrationRow = await requireGitProviderRegistration({
    organizationId: state.organizationId,
    registrationId: state.providerRegistrationId,
  });
  return await readGitHubProviderBootstrapPageForState(state, registration);
}

export function renderGitHubProviderBootstrapSuccessPage(): string {
  return '<!doctype html><html lang="en"><body><p>GitHub App installation completed. Return to the terminal.</p></body></html>';
}

async function createPendingGitHubBootstrap(
  input: StartGitHubProviderBootstrapInput,
  now: Date,
  pendingRegistration: GitProviderRegistrationRow | undefined,
  shouldFailPendingRegistration: boolean,
): Promise<GitHubProviderBootstrapView> {
  try {
    return await createPendingGitHubBootstrapTransaction(
      input,
      now,
      pendingRegistration,
      shouldFailPendingRegistration,
    );
  } catch (error) {
    if (!isUniqueConstraintError(error instanceof Error ? error : undefined)) {
      throw error;
    }

    return await recoverPendingBootstrapAfterRace(input, now);
  }
}

async function createPendingGitHubBootstrapTransaction(
  input: StartGitHubProviderBootstrapInput,
  now: Date,
  pendingRegistration: GitProviderRegistrationRow | undefined,
  shouldFailPendingRegistration: boolean,
): Promise<GitHubProviderBootstrapView> {
  return await getApiDatabase().transaction(
    async (transaction: GitProviderWriteExecutor): Promise<GitHubProviderBootstrapView> => {
      if (shouldFailPendingRegistration && pendingRegistration !== undefined) {
        await failPendingGitHubBootstrap(transaction, pendingRegistration, now);
      }

      const bootstrapMaterial: PendingGitHubBootstrapMaterial = buildPendingGitHubBootstrapMaterial({
        callbackPathname: gitHubCallbackPathname,
        compartmentUrl: input.compartmentUrl,
        now,
        organizationId: input.organizationId,
        ttlMs: gitHubBootstrapTtlMs,
      });
      await persistPendingGitHubBootstrap(transaction, input, bootstrapMaterial, now);
      return buildPendingBootstrapResponse(input, bootstrapMaterial.registrationId, bootstrapMaterial.stateId);
    },
  );
}

async function recoverPendingBootstrapAfterRace(
  input: StartGitHubProviderBootstrapInput,
  now: Date,
): Promise<GitHubProviderBootstrapView> {
  const lookup: PendingGitHubBootstrapLookup = await readPendingGitHubBootstrapLookup(input, now);
  if (lookup.reusableRegistration !== null) {
    return await readPendingGitHubBootstrapView(input.compartmentUrl, lookup.reusableRegistration);
  }

  const activeView: GitHubProviderBootstrapView | null = await readCurrentActiveGitHubBootstrapView(
    input,
    now,
    throwConcurrentGitHubBootstrapRecoveryError,
  );
  if (activeView !== null) {
    return activeView;
  }

  return await throwConcurrentGitHubBootstrapRecoveryError();
}

async function readPendingGitHubBootstrapLookup(
  input: StartGitHubProviderBootstrapInput,
  now: Date,
): Promise<PendingGitHubBootstrapLookup> {
  const pendingRegistration: GitProviderRegistrationRow | undefined = await findAnyPendingGitProviderRegistration(
    input.organizationId,
    input.providerHost,
    input.repositoryOwner,
  );

  return {
    pendingRegistration,
    reusableRegistration: await readReusablePendingGitHubBootstrap(pendingRegistration, now),
  };
}

async function readGitHubProviderBootstrapPageForState(
  state: GitProviderBootstrapStateRow,
  registration: GitProviderRegistrationRow,
): Promise<GitHubProviderBootstrapPage> {
  if (registration.appSlug !== null) {
    return {
      installUrl: buildGitHubAppInstallUrl(state.providerHost, registration.appSlug, state.id),
      kind: 'install',
    };
  }

  const manifestPlan: GitHubManifestPagePlan = await readGitHubAppManifestPlan({
    callbackUrl: registration.callbackUrl,
    controlPlaneUrl: readCompartmentUrl(),
    providerHost: state.providerHost,
    repositoryOwner: state.repositoryOwner,
    setupUrl: readGitHubSetupUrl(),
    webhookUrl: registration.webhookUrl,
  });
  return { ...manifestPlan, kind: 'manifest', stateNonce: state.stateNonce };
}

function readGitHubSetupUrl(): string {
  return new URL(gitHubSetupPathname, `${readCompartmentUrl()}/`).toString();
}

function readCompartmentUrl(): string {
  return buildRuntimePublicSettings(getApiConfig()).compartmentUrl;
}

async function readCurrentActiveGitHubBootstrapView(
  input: StartGitHubProviderBootstrapInput,
  now: Date,
  recoverAfterRace: () => Promise<GitHubProviderBootstrapView>,
): Promise<GitHubProviderBootstrapView | null> {
  return await readActiveGitHubBootstrapView({
    callbackPathname: gitHubCallbackPathname,
    gitHubBootstrapTtlMs,
    input,
    now,
    recoverAfterRace,
  });
}

async function throwConcurrentGitHubBootstrapRecoveryError(): Promise<GitHubProviderBootstrapView> {
  await Promise.resolve();
  throw createGitSourceRegistrationFailedError('Concurrent GitHub App bootstrap could not be recovered.');
}

function assertBootstrapPageOwner(state: GitProviderBootstrapStateRow, actorPrincipalId: string): void {
  if (state.createdByPrincipalId !== actorPrincipalId) {
    throw createGitSourceBootstrapInvalidError();
  }
}

function assertTrustedGitHubProviderHost(providerHost: string): void {
  if (isTrustedGitHubProviderHost(providerHost)) {
    return;
  }

  throw createGitSourceRegistrationFailedError(
    `GitHub Enterprise provider host ${providerHost} must be listed in COMPARTMENT_TRUSTED_OUTBOUND_HOSTS.`,
  );
}
