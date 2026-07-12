import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type {
  GitRepositoryFile,
  GitRepositoryMetadata,
  GitRepositorySummary,
  GitRepositoryTreeEntry,
} from './git-source-provider.types';
import { encodeGitLabProjectPath, type GitLabHttpClient } from './gitlab-http.adapter';

interface GitLabProject {
  default_branch: string | null;
  empty_repo?: boolean | undefined;
  http_url_to_repo: string;
  id: number;
  namespace: { full_path: string };
  path: string;
  path_with_namespace: string;
  visibility: string;
}
type ListableGitLabProject = GitLabProject & {
  default_branch: string;
  empty_repo?: false | undefined;
};
interface GitLabBranch {
  commit: { id: string };
}
interface GitLabTreeEntry {
  id: string;
  path: string;
  type: 'blob' | 'commit' | 'tree';
}
interface GitLabFile {
  blob_id: string;
  content: string;
  encoding: string;
}

const projectSchema: z.ZodType<GitLabProject> = z
  .object({
    default_branch: z.string().nullable(),
    empty_repo: z.boolean().optional(),
    http_url_to_repo: z.string(),
    id: z.number(),
    namespace: z.object({ full_path: z.string() }),
    path: z.string(),
    path_with_namespace: z.string(),
    visibility: z.string(),
  })
  .passthrough();
const branchSchema: z.ZodType<GitLabBranch> = z.object({ commit: z.object({ id: z.string() }) }).passthrough();
const treeSchema: z.ZodType<GitLabTreeEntry> = z
  .object({ id: z.string(), path: z.string(), type: z.enum(['blob', 'commit', 'tree']) })
  .passthrough();
const fileSchema: z.ZodType<GitLabFile> = z
  .object({ blob_id: z.string(), content: z.string(), encoding: z.string() })
  .passthrough();

export async function readGitLabProject(client: GitLabHttpClient, owner: string, name: string): Promise<GitLabProject> {
  return projectSchema.parse(await client.request({ path: `/projects/${encodeGitLabProjectPath(owner, name)}` }));
}

export const gitLabEmptyRepositoryFailureMessage: string = 'Git Repository is empty';

export function toGitRepositoryMetadata(project: GitLabProject): GitRepositoryMetadata {
  if (project.default_branch === null || project.empty_repo === true)
    throw new Error(gitLabEmptyRepositoryFailureMessage);
  return {
    defaultBranchName: project.default_branch,
    repositoryCloneUrl: project.http_url_to_repo,
    repositoryExternalId: String(project.id),
    repositoryName: project.path,
    repositoryOwner: project.namespace.full_path,
  };
}

export async function assertGitLabBranch(client: GitLabHttpClient, projectId: string, branch: string): Promise<void> {
  branchSchema.parse(
    await client.request({ path: `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}` }),
  );
}

export async function listGitLabProjects(client: GitLabHttpClient): Promise<GitRepositorySummary[]> {
  // Maintainer (40) access is the minimum that can create project hooks, which
  // source connect requires; listing lower-access projects would offer repos
  // whose connect is guaranteed to fail.
  const rows: GitLabProject[] = await client.requestPages(
    {
      path: '/projects',
      query: { archived: false, membership: true, min_access_level: 40, order_by: 'last_activity_at', simple: false },
    },
    50,
  );
  return rows
    .map((row: GitLabProject): GitLabProject => projectSchema.parse(row))
    .filter(isListableGitLabProject)
    .map(toSummary);
}

export async function readGitLabTree(
  client: GitLabHttpClient,
  projectId: string,
  ref: string,
): Promise<GitRepositoryTreeEntry[]> {
  const rows: GitLabTreeEntry[] = await client.requestPages(
    { path: `/projects/${projectId}/repository/tree`, query: { recursive: true, ref } },
    50,
  );
  return rows.map((row: GitLabTreeEntry): GitRepositoryTreeEntry => {
    const entry: GitLabTreeEntry = treeSchema.parse(row);
    return { path: entry.path, type: entry.type };
  });
}

export async function readGitLabFile(
  client: GitLabHttpClient,
  projectId: string,
  ref: string,
  path: string,
): Promise<GitRepositoryFile> {
  const file: GitLabFile = fileSchema.parse(
    await client.request({
      path: `/projects/${projectId}/repository/files/${encodeURIComponent(path)}`,
      query: { ref },
    }),
  );
  return {
    content: Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8'),
    sha: file.blob_id,
  };
}

function isListableGitLabProject(project: GitLabProject): project is ListableGitLabProject {
  return project.default_branch !== null && project.empty_repo !== true;
}

function toSummary(project: ListableGitLabProject): GitRepositorySummary {
  return {
    defaultBranchName: project.default_branch,
    fullName: project.path_with_namespace,
    private: project.visibility !== 'public',
    repositoryExternalId: String(project.id),
    repositoryName: project.path,
    repositoryOwner: project.namespace.full_path,
  };
}
