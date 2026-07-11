import { z } from 'zod';
import { GitLabHttpClient } from './gitlab-http.adapter';

interface GitLabUser {
  username: string;
}

const gitLabUserSchema: z.ZodType<GitLabUser> = z.object({ username: z.string().min(1) }).passthrough();

export async function readGitLabUser(providerHost: string, token: string): Promise<GitLabUser> {
  return gitLabUserSchema.parse(await new GitLabHttpClient({ providerHost, token }).request({ path: '/user' }));
}
