import {
  createGitSourceBootstrapInvalidError,
  createGitSourceRegistrationFailedError,
} from '../../errors/api-business-error';
import { findGitProviderBootstrapStateById } from '../../queries/git-provider-bootstrap-state.query';
import { findGitProviderRegistrationById } from '../../queries/git-provider-registration.query';
import type {
  FindGitProviderRegistrationByIdInput,
  GitProviderBootstrapStateRow,
  GitProviderRegistrationRow,
} from '../../queries/git-provider-registration.query.types';
import {
  buildGitHubBootstrapBrowserUrl,
  buildGitHubBootstrapView,
  buildPendingGitHubBootstrapView,
  type GitHubBootstrapStatus,
  readGitHubBootstrapStatus,
} from './git-source-bootstrap.support';
import type { GitHubProviderBootstrapView, StartGitHubProviderBootstrapInput } from './git-source.service.types';
import { requireGitProviderAccessByRegistrationId } from './git-source-provider-access.service';
import type { GitProviderAccess, GitProviderCredential } from './git-source-provider.types';

export async function readGitHubBootstrapViewForState(
  compartmentUrl: string,
  state: GitProviderBootstrapStateRow,
): Promise<GitHubProviderBootstrapView> {
  const registration: GitProviderRegistrationRow = await requireGitProviderRegistration({
    organizationId: state.organizationId,
    registrationId: state.providerRegistrationId,
  });
  const status: GitHubBootstrapStatus = readGitHubBootstrapStatus(registration.status);
  const credential: Extract<GitProviderCredential, { kind: 'github_app' }> | null = await readActiveCredential(
    registration,
    status,
  );
  return buildGitHubBootstrapView(
    registration.id,
    state.providerHost,
    state.repositoryOwner,
    credential?.installationAccountLogin ?? null,
    credential?.installationId ?? null,
    status,
    state.id,
    status === 'active' ? null : buildGitHubBootstrapBrowserUrl(compartmentUrl, state.id),
  );
}

async function readActiveCredential(
  registration: GitProviderRegistrationRow,
  status: GitHubBootstrapStatus,
): Promise<Extract<GitProviderCredential, { kind: 'github_app' }> | null> {
  if (status !== 'active') return null;
  const access: GitProviderAccess = await requireGitProviderAccessByRegistrationId(
    registration.organizationId,
    registration.id,
  );
  return requireGitHubCredential(access.credential);
}

function requireGitHubCredential(
  credential: GitProviderCredential,
): Extract<GitProviderCredential, { kind: 'github_app' }> {
  if (credential.kind !== 'github_app') {
    throw createGitSourceRegistrationFailedError('Git provider registration has invalid credentials.');
  }
  return credential;
}

export function buildPendingBootstrapResponse(
  input: StartGitHubProviderBootstrapInput,
  registrationId: string,
  stateId: string,
): GitHubProviderBootstrapView {
  return buildGitHubBootstrapView(
    registrationId,
    input.providerHost,
    input.repositoryOwner,
    null,
    null,
    'pending',
    stateId,
    buildGitHubBootstrapBrowserUrl(input.compartmentUrl, stateId),
  );
}

export async function readPendingGitHubBootstrapView(
  compartmentUrl: string,
  registration: GitProviderRegistrationRow,
): Promise<GitHubProviderBootstrapView> {
  requirePendingBootstrapState(
    await findGitProviderBootstrapStateById({
      bootstrapStateId: requireBootstrapStateId(registration),
      organizationId: registration.organizationId,
    }),
  );
  return buildPendingGitHubBootstrapView(compartmentUrl, registration);
}

export function requireBootstrapPageState(
  state: GitProviderBootstrapStateRow | undefined,
): GitProviderBootstrapStateRow {
  if (state === undefined) {
    throw createGitSourceBootstrapInvalidError();
  }
  if (state.completedAt !== null || state.expiresAt <= new Date()) {
    throw createGitSourceBootstrapInvalidError();
  }

  return state;
}

function requirePendingBootstrapState(state: GitProviderBootstrapStateRow | undefined): GitProviderBootstrapStateRow {
  if (state === undefined) {
    throw createGitSourceRegistrationFailedError('Pending GitHub App bootstrap state is missing.');
  }

  return state;
}

function requireBootstrapStateId(registration: GitProviderRegistrationRow): string {
  if (registration.bootstrapStateId === null) {
    throw createGitSourceRegistrationFailedError('Pending GitHub App bootstrap state id is missing.');
  }

  return registration.bootstrapStateId;
}

export async function requireGitProviderRegistration(
  input: FindGitProviderRegistrationByIdInput,
): Promise<GitProviderRegistrationRow> {
  const registration: GitProviderRegistrationRow | undefined = await findGitProviderRegistrationById(input);
  if (registration === undefined) {
    throw createGitSourceRegistrationFailedError();
  }

  return registration;
}
