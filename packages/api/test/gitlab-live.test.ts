import { afterAll, describe, expect, it } from 'vitest';

const token: string | undefined = process.env.COMPARTMENT_GITLAB_E2E_TOKEN;
const apiBaseUrl: string = 'https://gitlab.com/api/v4';
const runSlug: string = `compartment-e2e-${Date.now().toString(36)}`;
let groupId: number | undefined;
let groupPath: string | undefined;
let createdTopLevelGroup: boolean = false;
let subgroupId: number | undefined;
const createdProjectIds: number[] = [];

describe.skipIf(token === undefined || token.length === 0)('GitLab live E2E smoke', (): void => {
  it('creates projects, commits twice, lists subgroup paths, and merges a request', async (): Promise<void> => {
    let group: GitLabGroup;
    try {
      group = await gitlabPost<GitLabGroup>('/groups', {
        name: runSlug,
        path: runSlug,
        visibility: 'private',
      });
      createdTopLevelGroup = true;
    } catch (error) {
      if (!(error instanceof GitLabGroupCreateForbiddenError)) throw error;
      const existing: GitLabGroup[] = await gitlabGet<GitLabGroup[]>('/groups?search=compartment-e2e&per_page=20');
      const accessible: GitLabGroup | undefined = existing.find(
        (candidate: GitLabGroup): boolean => candidate.full_path === 'compartment-e2e',
      );
      if (accessible === undefined) throw new Error('No accessible compartment-e2e GitLab group found');
      group = accessible;
    }
    groupId = group.id;
    groupPath = group.full_path;
    const subgroupPath: string = `subgroup-${runSlug}`;
    const subgroup: GitLabGroup = await gitlabPost<GitLabGroup>('/groups', {
      name: subgroupPath,
      parent_id: group.id,
      path: subgroupPath,
      visibility: 'private',
    });
    subgroupId = subgroup.id;
    const normalPath: string = `normal-${runSlug}`;
    const emptyPath: string = `empty-${runSlug}`;
    const normal: GitLabProject = await createProject(group.id, normalPath);
    createdProjectIds.push(normal.id);
    const nested: GitLabProject = await createProject(subgroup.id, `project-${runSlug}`);
    createdProjectIds.push(nested.id);
    const empty: GitLabProject = await createProject(group.id, emptyPath, false);
    createdProjectIds.push(empty.id);

    await createFile(normal.id, 'first.txt', 'first', 'main');
    await createFile(normal.id, 'second.txt', 'second', 'main');
    const branch: string = 'compartment-e2e-feature';
    await createFile(normal.id, 'merge-request.txt', 'merge request', branch);
    const mergeRequest: GitLabMergeRequest = await gitlabPost<GitLabMergeRequest>(
      `/projects/${normal.id}/merge_requests`,
      { source_branch: branch, target_branch: 'main', title: 'Compartment E2E merge request' },
    );
    let mergeState: GitLabMergeRequest = mergeRequest;
    for (let attempt: number = 0; attempt < 15; attempt += 1) {
      mergeState = await gitlabGet<GitLabMergeRequest>(`/projects/${normal.id}/merge_requests/${mergeRequest.iid}`);
      if (mergeState.merge_status === 'can_be_merged') break;
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 500);
      });
    }
    if (mergeState.merge_status !== 'can_be_merged') {
      throw new Error(`Merge request not mergeable: ${mergeState.merge_status}/${mergeState.detailed_merge_status}`);
    }
    const merged: GitLabMergeRequest = await gitlabPut<GitLabMergeRequest>(
      `/projects/${normal.id}/merge_requests/${mergeRequest.iid}/merge`,
      { auto_merge: false, merge_when_pipeline_succeeds: false, sha: mergeRequest.sha },
    );
    const projects: GitLabProject[] = await gitlabGet<GitLabProject[]>(
      `/groups/${group.id}/projects?include_subgroups=true`,
    );
    expect(projects.map((project: GitLabProject): string => project.path_with_namespace)).toEqual(
      expect.arrayContaining([normal.path_with_namespace, nested.path_with_namespace, empty.path_with_namespace]),
    );
    expect(nested.path_with_namespace).toBe(`${groupPath}/${subgroupPath}/project-${runSlug}`);
    expect(normal.path).toBe(normalPath);
    expect(empty.empty_repo).toBe(true);
    expect(merged.state).toBe('merged');
  }, 120_000);
});

afterAll(async (): Promise<void> => {
  if (token === undefined) return;
  for (const projectId of createdProjectIds) {
    try {
      await gitlabDelete(`/projects/${projectId}`);
    } catch {
      // Best-effort cleanup.
    }
  }
  if (subgroupId !== undefined) {
    try {
      await gitlabDelete(`/groups/${subgroupId}`);
    } catch {
      // Best-effort cleanup.
    }
  }
  if (createdTopLevelGroup && groupId !== undefined) {
    try {
      await gitlabDelete(`/groups/${groupId}`);
    } catch {
      // Best-effort cleanup.
    }
  }
});

interface GitLabGroup {
  id: number;
  full_path: string;
}
interface GitLabProject {
  id: number;
  path: string;
  path_with_namespace: string;
  empty_repo: boolean;
}
interface GitLabMergeRequest {
  iid: number;
  state: string;
  sha: string;
  merge_status?: string;
  detailed_merge_status?: string;
}

async function createProject(
  namespaceId: number,
  path: string,
  initializeWithReadme: boolean = true,
): Promise<GitLabProject> {
  return await gitlabPost<GitLabProject>('/projects', {
    initialize_with_readme: initializeWithReadme,
    name: path,
    namespace_id: namespaceId,
    path,
    visibility: 'private',
  });
}

async function createFile(projectId: number, filePath: string, content: string, branch: string): Promise<void> {
  await gitlabPost(`/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}`, {
    branch,
    commit_message: `Compartment E2E ${filePath}`,
    content,
    ...(branch !== 'main' ? { start_branch: 'main' } : {}),
  });
}

async function gitlabGet<TResult>(path: string): Promise<TResult> {
  return await gitlabRequest<TResult>('GET', path);
}
async function gitlabPost<TResult = void>(path: string, body: object): Promise<TResult> {
  return await gitlabRequest<TResult>('POST', path, body);
}
async function gitlabPut<TResult>(path: string, body: object): Promise<TResult> {
  return await gitlabRequest<TResult>('PUT', path, body);
}
async function gitlabDelete(path: string): Promise<void> {
  await gitlabRequest('DELETE', path);
}

async function gitlabRequest<TResult>(method: string, path: string, body?: object): Promise<TResult> {
  const response: Response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (method === 'POST' && path === '/groups' && response.status === 403) {
      throw new GitLabGroupCreateForbiddenError();
    }
    const detail: string = await response.text();
    throw new Error(`GitLab API request failed: ${method} ${path} (${response.status}): ${detail}`);
  }
  if (response.status === 204) return undefined as TResult;
  return (await response.json()) as TResult;
}

class GitLabGroupCreateForbiddenError extends Error {
  public constructor() {
    super('GitLab group creation forbidden');
  }
}
