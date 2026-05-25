import { findActiveGitProviderRegistration } from '../../queries/git-provider-registration.query';
import type {
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
} from '../../queries/git-provider-registration.query.types';
import { isUniqueConstraintError } from '../../queries/query-error';
import { getApiDatabase } from '../../runtime/runtime-access';
import {
  failActiveGitHubProviderRegistration,
  failPendingGitHubBootstrapForOwner,
  persistPendingGitHubBootstrap,
  reopenActiveGitHubProviderRegistrationBootstrap,
} from './git-source-bootstrap.persistence';
import {
  buildGitHubBootstrapView,
  buildPendingGitHubBootstrapMaterial,
  buildPendingGitHubBootstrapMaterialForRegistration,
  type PendingGitHubBootstrapMaterial,
} from './git-source-bootstrap.support';
import { buildPendingBootstrapResponse } from './git-source-bootstrap.read';
import {
  readActiveGitHubRegistrationState,
  type ActiveGitHubRegistrationState,
} from './git-source-bootstrap-active-validation.service';
import type { GitHubProviderBootstrapView, StartGitHubProviderBootstrapInput } from './git-source.service.types';

type RecoverGitHubBootstrapAfterRace = () => Promise<GitHubProviderBootstrapView>;
type GitHubBootstrapRecoveryMutation = (transaction: GitProviderWriteExecutor) => Promise<GitHubProviderBootstrapView>;
type BuildGitHubBootstrapRecovery = (transaction: GitProviderWriteExecutor) => Promise<GitHubBootstrapRecoveryResult>;

interface GitHubBootstrapRecoveryResult {
  material: PendingGitHubBootstrapMaterial;
  registrationId: string;
}

interface GitHubBootstrapMaterialInput {
  callbackPathname: string;
  compartmentUrl: string;
  now: Date;
  organizationId: string;
  ttlMs: number;
}

interface ReadActiveGitHubBootstrapViewInput {
  callbackPathname: string;
  gitHubBootstrapTtlMs: number;
  input: StartGitHubProviderBootstrapInput;
  now: Date;
  recoverAfterRace: RecoverGitHubBootstrapAfterRace;
}

export async function readActiveGitHubBootstrapView(
  options: ReadActiveGitHubBootstrapViewInput,
): Promise<GitHubProviderBootstrapView | null> {
  const registration: GitProviderRegistrationRow | undefined = await findActiveGitProviderRegistration({
    organizationId: options.input.organizationId,
    providerHost: options.input.providerHost,
    repositoryOwner: options.input.repositoryOwner,
  });
  if (registration === undefined) {
    return null;
  }

  return await readActiveGitHubBootstrapViewForRegistration(options, registration);
}

async function readActiveGitHubBootstrapViewForRegistration(
  options: ReadActiveGitHubBootstrapViewInput,
  registration: GitProviderRegistrationRow,
): Promise<GitHubProviderBootstrapView> {
  const state: ActiveGitHubRegistrationState = await readActiveGitHubRegistrationState(registration);
  if (state === 'valid') {
    return buildActiveGitHubBootstrapView(registration);
  }
  if (state === 'installation_missing') {
    return await reopenGitHubAppInstallationBootstrap(options, registration);
  }

  return await replaceMissingGitHubAppBootstrap(options, registration);
}

async function reopenGitHubAppInstallationBootstrap(
  options: ReadActiveGitHubBootstrapViewInput,
  registration: GitProviderRegistrationRow,
): Promise<GitHubProviderBootstrapView> {
  return await recoverGitHubAppBootstrap(
    options,
    async (transaction: GitProviderWriteExecutor): Promise<GitHubBootstrapRecoveryResult> => {
      const material: PendingGitHubBootstrapMaterial = buildActiveRegistrationBootstrapMaterial(options, registration);
      await reopenActiveGitHubProviderRegistrationBootstrap(transaction, options.input, material, options.now);

      return {
        material,
        registrationId: registration.id,
      };
    },
  );
}

async function replaceMissingGitHubAppBootstrap(
  options: ReadActiveGitHubBootstrapViewInput,
  registration: GitProviderRegistrationRow,
): Promise<GitHubProviderBootstrapView> {
  return await recoverGitHubAppBootstrap(
    options,
    async (transaction: GitProviderWriteExecutor): Promise<GitHubBootstrapRecoveryResult> => {
      await failActiveGitHubProviderRegistration(transaction, registration, options.now);
      const material: PendingGitHubBootstrapMaterial = buildFreshRegistrationBootstrapMaterial(options);
      await persistPendingGitHubBootstrap(transaction, options.input, material, options.now);

      return {
        material,
        registrationId: material.registrationId,
      };
    },
  );
}

async function recoverGitHubAppBootstrap(
  options: ReadActiveGitHubBootstrapViewInput,
  buildRecovery: BuildGitHubBootstrapRecovery,
): Promise<GitHubProviderBootstrapView> {
  return await runGitHubBootstrapRecoveryMutation(
    options,
    async (transaction: GitProviderWriteExecutor): Promise<GitHubProviderBootstrapView> => {
      await failPendingGitHubBootstrapForOwner(
        transaction,
        options.input.organizationId,
        options.input.providerHost,
        options.input.repositoryOwner,
        options.now,
      );

      const recovery: GitHubBootstrapRecoveryResult = await buildRecovery(transaction);
      return buildPendingBootstrapResponse(options.input, recovery.registrationId, recovery.material.stateId);
    },
  );
}

async function runGitHubBootstrapRecoveryMutation(
  options: ReadActiveGitHubBootstrapViewInput,
  mutation: GitHubBootstrapRecoveryMutation,
): Promise<GitHubProviderBootstrapView> {
  try {
    return await getApiDatabase().transaction(mutation);
  } catch (error) {
    if (!isUniqueConstraintError(error instanceof Error ? error : undefined)) {
      throw error;
    }

    return await options.recoverAfterRace();
  }
}

function buildActiveGitHubBootstrapView(registration: GitProviderRegistrationRow): GitHubProviderBootstrapView {
  return buildGitHubBootstrapView(
    registration.id,
    registration.providerHost,
    registration.repositoryOwner,
    registration.installationAccountLogin,
    registration.installationId,
    'active',
    null,
    null,
  );
}

function buildActiveRegistrationBootstrapMaterial(
  options: ReadActiveGitHubBootstrapViewInput,
  registration: GitProviderRegistrationRow,
): PendingGitHubBootstrapMaterial {
  return buildPendingGitHubBootstrapMaterialForRegistration(buildBootstrapMaterialInput(options), {
    callbackUrl: registration.callbackUrl,
    registrationId: registration.id,
    webhookUrl: registration.webhookUrl,
  });
}

function buildFreshRegistrationBootstrapMaterial(
  options: ReadActiveGitHubBootstrapViewInput,
): PendingGitHubBootstrapMaterial {
  return buildPendingGitHubBootstrapMaterial(buildBootstrapMaterialInput(options));
}

function buildBootstrapMaterialInput(options: ReadActiveGitHubBootstrapViewInput): GitHubBootstrapMaterialInput {
  return {
    callbackPathname: options.callbackPathname,
    compartmentUrl: options.input.compartmentUrl,
    now: options.now,
    organizationId: options.input.organizationId,
    ttlMs: options.gitHubBootstrapTtlMs,
  };
}
