import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  createGitSourceRequestInvalidError,
  createGitSourceRequestUnauthorizedError,
} from '../../errors/api-business-error';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { readGitProviderWebhookSecret } from './git-source-runtime.support';
import type { GitLabJsonObject } from './gitlab-http.adapter.types';
import type { GitLabPushCommit, GitLabPushPayload, ParsedGitLabPush } from './gitlab-webhook.adapter.types';

const branchPrefix: string = 'refs/heads/';
const pushSchema: z.ZodType<GitLabPushPayload> = z.object({
  checkout_sha: z.string().nullable(),
  commits: z.array(
    z.object({
      added: z.array(z.string()).optional(),
      modified: z.array(z.string()).optional(),
      removed: z.array(z.string()).optional(),
    }),
  ),
  object_kind: z.literal('push'),
  project: z.object({ id: z.number(), path_with_namespace: z.string().optional() }),
  ref: z.string(),
  total_commits_count: z.number().optional(),
});

export function verifyGitLabWebhookToken(registration: GitProviderRegistrationRow, token: string): void {
  const expected: Buffer = Buffer.from(readGitProviderWebhookSecret(registration));
  const actual: Buffer = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw createGitSourceRequestUnauthorizedError('GitLab webhook token is invalid.');
  }
}

export function parseGitLabPushPayload(body: GitLabJsonObject): ParsedGitLabPush | null {
  const parsed: z.SafeParseReturnType<GitLabPushPayload, GitLabPushPayload> = pushSchema.safeParse(body);
  if (!parsed.success) throw createGitSourceRequestInvalidError('GitLab push payload is invalid.');
  const payload: GitLabPushPayload = parsed.data;
  if (!payload.ref.startsWith(branchPrefix) || payload.checkout_sha === null) return null;
  return buildParsedPush(payload, payload.checkout_sha);
}

function buildParsedPush(payload: GitLabPushPayload, commitSha: string): ParsedGitLabPush {
  const changedFiles: string[] = [...new Set(payload.commits.flatMap(readCommitFiles))];
  return {
    branchName: payload.ref.slice(branchPrefix.length),
    changedFiles,
    changedFilesComplete:
      payload.total_commits_count !== undefined &&
      payload.total_commits_count <= payload.commits.length &&
      payload.commits.every(hasCompleteFileArrays),
    commitSha,
    repositoryExternalId: String(payload.project.id),
  };
}

function hasCompleteFileArrays(commit: GitLabPushCommit): boolean {
  return commit.added !== undefined && commit.modified !== undefined && commit.removed !== undefined;
}

function readCommitFiles(commit: GitLabPushCommit): string[] {
  return [...(commit.added ?? []), ...(commit.modified ?? []), ...(commit.removed ?? [])];
}
