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
  name: string;
  namespace: { full_path: string };
  path_with_namespace: string;
  visibility: string;
}
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
    name: z.string(),
    namespace: z.object({ full_path: z.string() }),
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

export function toGitRepositoryMetadata(project: GitLabProject): GitRepositoryMetadata {
  if (project.default_branch === null || project.empty_repo === true) throw new Error('Git Repository is empty');
  return {
    defaultBranchName: project.default_branch,
    repositoryCloneUrl: project.http_url_to_repo,
    repositoryExternalId: String(project.id),
    repositoryName: project.name,
    repositoryOwner: project.namespace.full_path,
  };
}

export async function assertGitLabBranch(client: GitLabHttpClient, projectId: string, branch: string): Promise<void> {
  branchSchema.parse(
    await client.request({ path: `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}` }),
  );
}

export async function listGitLabProjects(client: GitLabHttpClient): Promise<GitRepositorySummary[]> {
  const rows: GitLabProject[] = await client.requestPages(
    {
      path: '/projects',
      query: { archived: false, membership: true, min_access_level: 30, order_by: 'last_activity_at', simple: false },
    },
    10,
  );
  return rows.map((row: GitLabProject): GitRepositorySummary => toSummary(projectSchema.parse(row)));
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

function toSummary(project: GitLabProject): GitRepositorySummary {
  return {
    defaultBranchName: project.default_branch ?? '',
    fullName: project.path_with_namespace,
    private: project.visibility !== 'public',
    repositoryExternalId: String(project.id),
    repositoryName: project.name,
    repositoryOwner: project.namespace.full_path,
  };
}
