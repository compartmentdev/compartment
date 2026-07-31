import { z } from 'zod';
import { isGitLabNotFoundFailure, type GitLabHttpClient } from './gitlab-http.adapter';

interface GitLabProjectHook {
  id: number;
}
const hookSchema: z.ZodType<GitLabProjectHook> = z.object({ id: z.number() }).passthrough();

export async function createGitLabProjectHook(
  client: GitLabHttpClient,
  projectId: string,
  url: string,
  token: string,
): Promise<string> {
  const hook: GitLabProjectHook = hookSchema.parse(
    await client.request({
      body: { enable_ssl_verification: true, push_events: true, token, url },
      method: 'POST',
      path: `/projects/${projectId}/hooks`,
    }),
  );
  return String(hook.id);
}

export async function deleteGitLabProjectHook(
  client: GitLabHttpClient,
  projectId: string,
  hookId: string,
): Promise<void> {
  try {
    await client.request({ method: 'DELETE', path: `/projects/${projectId}/hooks/${hookId}` });
  } catch (error) {
    if (!isGitLabNotFoundFailure(error instanceof Error ? error : undefined)) throw error;
  }
}
