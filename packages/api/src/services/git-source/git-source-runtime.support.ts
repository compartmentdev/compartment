import { createHmac, timingSafeEqual } from 'node:crypto';
import { hasText, isPathWithinDirectory } from '@compartment/utils';
import {
  createGitSourceBootstrapInvalidError,
  createGitSourceRequestInvalidError,
  createGitSourceRequestUnauthorizedError,
} from '../../errors/api-business-error';
import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import type { SourceBindingBranchMappingRow, SourceBindingRow } from '../../queries/source.query.types';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import type {
  GitHubInstallationWebhookPayload,
  GitHubPushCommitPayload,
  GitHubPushWebhookPayload,
  GitHubRepositoryWebhookPayload,
  GitHubWebhookObject,
  GitHubWebhookValue,
} from './git-source-runtime.service.types';

const gitHubRefPrefix: string = 'refs/heads/';

export function verifyGitHubWebhookSignature(rawBody: Buffer, signature: string, secret: string): void {
  const expected: Buffer = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`, 'utf8');
  const actual: Buffer = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw createGitSourceRequestUnauthorizedError('GitHub webhook signature is invalid.');
  }
}

export function readGitHubWebhookSecret(registration: GitProviderRegistrationRow): string {
  if (registration.webhookSecretCiphertext === null || registration.webhookSecretEncryptionKeyId === null) {
    throw createGitSourceBootstrapInvalidError(
      'Git provider registration is missing webhook credentials and must be reconnected.',
    );
  }

  return decryptVariableValueFromStorage(
    registration.webhookSecretCiphertext,
    registration.webhookSecretEncryptionKeyId,
    getApiConfig().variablesMasterKey,
  );
}

export function requireGitHubPushWebhookPayload(body: GitHubWebhookObject): GitHubPushWebhookPayload {
  if (!hasTextValue(body.after) || !hasTextValue(body.ref) || !isRecord(body.repository)) {
    throw createGitSourceRequestInvalidError('GitHub push payload is invalid.');
  }

  return body as GitHubPushWebhookPayload;
}

export function requireGitHubInstallationWebhookPayload(body: GitHubWebhookObject): GitHubInstallationWebhookPayload {
  if (!hasTextValue(body.action)) {
    throw createGitSourceRequestInvalidError('GitHub installation payload is invalid.');
  }

  return body as GitHubInstallationWebhookPayload;
}

export function readPushBranchName(payload: GitHubPushWebhookPayload): string | null {
  return payload.ref.startsWith(gitHubRefPrefix) ? payload.ref.slice(gitHubRefPrefix.length) : null;
}

export function readPushInstallationId(payload: GitHubPushWebhookPayload): string {
  return readGitHubInstallationId(payload.installation);
}

export function readInstallationWebhookInstallationId(payload: GitHubInstallationWebhookPayload): string {
  return readGitHubInstallationId(payload.installation);
}

export function readRepositoryExternalId(repository: GitHubRepositoryWebhookPayload): string {
  if (typeof repository.id !== 'number') {
    throw createGitSourceRequestInvalidError('GitHub repository payload is missing id.');
  }

  return String(repository.id);
}

export function readRepositoryOwner(repository: GitHubRepositoryWebhookPayload): string {
  if (!hasText(repository.owner?.login)) {
    throw createGitSourceRequestInvalidError('GitHub repository payload is missing owner login.');
  }

  return repository.owner.login;
}

export function readChangedFiles(payload: GitHubPushWebhookPayload): {
  changedFiles: string[];
  changedFilesComplete: boolean;
} {
  const commits: GitHubPushCommitPayload[] = Array.isArray(payload.commits) ? payload.commits : [];
  const changedFiles: Set<string> = new Set<string>();

  for (const commit of commits) {
    if (!Array.isArray(commit.added) || !Array.isArray(commit.modified) || !Array.isArray(commit.removed)) {
      return { changedFiles: [], changedFilesComplete: false };
    }

    for (const path of [...commit.added, ...commit.modified, ...commit.removed]) {
      if (hasText(path)) {
        changedFiles.add(path);
      }
    }
  }

  const changedFilesComplete: boolean = commits.length > 0 && (payload.size ?? commits.length) <= commits.length;
  return {
    changedFiles: [...changedFiles].sort((left: string, right: string): number => left.localeCompare(right)),
    changedFilesComplete,
  };
}

export function isBindingAffectedByPush(
  binding: SourceBindingRow,
  branchMappings: readonly SourceBindingBranchMappingRow[],
  branchName: string,
  changedFiles: readonly string[],
  changedFilesComplete: boolean,
): boolean {
  if (!branchMappings.some((mapping: SourceBindingBranchMappingRow): boolean => mapping.branchName === branchName)) {
    return false;
  }
  if (!binding.autoDeployEnabled) {
    return false;
  }
  if (!changedFilesComplete) {
    return true;
  }

  return changedFiles.some((changedFile: string): boolean => isChangedFileRelevantToBinding(binding, changedFile));
}

export function validateRepositoryOwnerMatch(registration: GitProviderRegistrationRow, repositoryOwner: string): void {
  if (registration.repositoryOwner === repositoryOwner) {
    return;
  }

  throw createGitSourceRequestInvalidError('GitHub webhook repository owner did not match the provider registration.');
}

function readGitHubInstallationId(installation: { id?: number | undefined } | undefined): string {
  if (typeof installation?.id !== 'number') {
    throw createGitSourceRequestInvalidError('GitHub payload is missing installation id.');
  }

  return String(installation.id);
}

function isChangedFileRelevantToBinding(binding: SourceBindingRow, changedFile: string): boolean {
  if (isPathWithinDirectory(binding.descriptorDirectory, changedFile)) {
    return true;
  }

  return readBindingWatchPaths(binding).some((watchPath: string): boolean =>
    isPathWithinDirectory(watchPath, changedFile),
  );
}

function readBindingWatchPaths(binding: SourceBindingRow): string[] {
  try {
    return readTextList(JSON.parse(binding.watchPathsJson) as GitHubWebhookValue);
  } catch {
    return [];
  }
}

function hasTextValue(value: GitHubWebhookValue | undefined): value is string {
  return typeof value === 'string' && hasText(value);
}

function readTextList(value: GitHubWebhookValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry: GitHubWebhookValue): entry is string => typeof entry === 'string' && hasText(entry));
}

function isRecord(value: GitHubWebhookValue | undefined): value is GitHubWebhookObject {
  return typeof value === 'object' && value !== null;
}
