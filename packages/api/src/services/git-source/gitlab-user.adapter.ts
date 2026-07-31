import { z } from 'zod';
import { GitLabHttpClient } from './gitlab-http.adapter';

export interface GitLabTokenIdentity {
  expiresAt: Date | null;
  userId: string;
  username: string;
}

export class GitLabTokenValidationError extends Error {}

interface GitLabUser {
  id: number;
  username: string;
}

interface GitLabPersonalAccessToken {
  active: boolean;
  expires_at: string | null;
  revoked: boolean;
  scopes: string[];
  user_id: number;
}

const gitLabUserSchema: z.ZodType<GitLabUser> = z
  .object({ id: z.number().int().positive(), username: z.string().min(1) })
  .passthrough();
const gitLabPersonalAccessTokenSchema: z.ZodType<GitLabPersonalAccessToken> = z
  .object({
    active: z.boolean(),
    expires_at: z.string().min(1).nullable(),
    revoked: z.boolean(),
    scopes: z.array(z.string()),
    user_id: z.number().int().positive(),
  })
  .passthrough();

export async function readGitLabTokenIdentity(providerHost: string, token: string): Promise<GitLabTokenIdentity> {
  const client: GitLabHttpClient = new GitLabHttpClient({ providerHost, token });
  const tokenInfo: GitLabPersonalAccessToken = gitLabPersonalAccessTokenSchema.parse(
    await client.request({ path: '/personal_access_tokens/self' }),
  );
  if (!tokenInfo.active || tokenInfo.revoked) {
    throw new GitLabTokenValidationError('The GitLab personal access token is inactive or revoked.');
  }
  if (!tokenInfo.scopes.includes('api')) {
    throw new GitLabTokenValidationError('The GitLab personal access token must include the api scope.');
  }
  const user: GitLabUser = gitLabUserSchema.parse(await client.request({ path: '/user' }));
  if (user.id !== tokenInfo.user_id) {
    throw new GitLabTokenValidationError(
      'The GitLab personal access token user does not match the authenticated user.',
    );
  }
  return {
    expiresAt: tokenInfo.expires_at === null ? null : parseGitLabExpiry(tokenInfo.expires_at),
    userId: String(user.id),
    username: user.username,
  };
}

function parseGitLabExpiry(value: string): Date {
  const expiresAt: Date = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new GitLabTokenValidationError('The GitLab personal access token has an invalid expiration date.');
  }
  return expiresAt;
}
