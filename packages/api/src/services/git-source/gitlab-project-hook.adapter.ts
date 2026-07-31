import { z } from 'zod';
import { isGitLabNotFoundFailure, type GitLabHttpClient } from './gitlab-http.adapter';
import type { GitLabJsonValue } from './gitlab-http.adapter.types';

interface GitLabProjectHook {
  id: number;
  url: string;
}

const gitLabProjectHookSchema: z.ZodType<GitLabProjectHook> = z
  .object({ id: z.number().int().positive(), url: z.string().url() })
  .passthrough();

export async function ensureGitLabProjectHook(
  client: GitLabHttpClient,
  projectId: string,
  url: string,
  token: string,
  persistedHookId: string | null,
): Promise<string> {
  await removeMismatchedPersistedHook(client, projectId, url, persistedHookId);
  const matching: GitLabProjectHook[] = await createOrRecoverMatchingHooks(client, projectId, url, token);
  const canonical: GitLabProjectHook | undefined = matching.toSorted(
    (left: GitLabProjectHook, right: GitLabProjectHook): number => left.id - right.id,
  )[0];
  if (canonical === undefined) throw new Error('GitLab project hook creation did not produce a hook.');
  for (const duplicate of matching.slice(1)) {
    await deleteGitLabProjectHook(client, projectId, String(duplicate.id));
  }
  return String(canonical.id);
}

async function createOrRecoverMatchingHooks(
  client: GitLabHttpClient,
  projectId: string,
  url: string,
  token: string,
): Promise<GitLabProjectHook[]> {
  const existing: GitLabProjectHook[] = await listMatchingHooks(client, projectId, url);
  if (existing.length > 0) return existing;
  try {
    await createGitLabProjectHook(client, projectId, url, token);
  } catch (error) {
    const recovered: GitLabProjectHook[] = await listMatchingHooks(client, projectId, url);
    if (recovered.length === 0) throw error;
  }
  return await listMatchingHooks(client, projectId, url);
}

export async function removeGitLabProjectHooks(
  client: GitLabHttpClient,
  projectId: string,
  url: string,
  persistedHookId: string | null,
): Promise<void> {
  const hookIds: Set<string> = new Set<string>(
    (await listMatchingHooks(client, projectId, url)).map((hook: GitLabProjectHook): string => String(hook.id)),
  );
  if (persistedHookId !== null) hookIds.add(persistedHookId);
  for (const hookId of hookIds) await deleteGitLabProjectHook(client, projectId, hookId);
}

async function listMatchingHooks(
  client: GitLabHttpClient,
  projectId: string,
  url: string,
): Promise<GitLabProjectHook[]> {
  return (await client.requestPages<GitLabJsonValue>({ path: `/projects/${projectId}/hooks` }, 10))
    .map((value: GitLabJsonValue): GitLabProjectHook => gitLabProjectHookSchema.parse(value))
    .filter((hook: GitLabProjectHook): boolean => hook.url === url);
}

async function createGitLabProjectHook(
  client: GitLabHttpClient,
  projectId: string,
  url: string,
  token: string,
): Promise<void> {
  gitLabProjectHookSchema.parse(
    await client.request({
      body: { enable_ssl_verification: true, push_events: true, token, url },
      method: 'POST',
      path: `/projects/${projectId}/hooks`,
    }),
  );
}

async function removeMismatchedPersistedHook(
  client: GitLabHttpClient,
  projectId: string,
  url: string,
  persistedHookId: string | null,
): Promise<void> {
  if (persistedHookId === null) return;
  const hooks: GitLabProjectHook[] = (
    await client.requestPages<GitLabJsonValue>({ path: `/projects/${projectId}/hooks` }, 10)
  ).map((value: GitLabJsonValue): GitLabProjectHook => gitLabProjectHookSchema.parse(value));
  const persisted: GitLabProjectHook | undefined = hooks.find(
    (hook: GitLabProjectHook): boolean => String(hook.id) === persistedHookId,
  );
  if (persisted !== undefined && persisted.url !== url) {
    await deleteGitLabProjectHook(client, projectId, persistedHookId);
  }
}

async function deleteGitLabProjectHook(client: GitLabHttpClient, projectId: string, hookId: string): Promise<void> {
  try {
    await client.request({ method: 'DELETE', path: `/projects/${projectId}/hooks/${hookId}` });
  } catch (error) {
    if (!isGitLabNotFoundFailure(error instanceof Error ? error : undefined)) throw error;
  }
}
