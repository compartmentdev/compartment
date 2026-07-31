import type { GitDescriptorDraftFile } from '@compartment/contracts';
import { z } from 'zod';
import { createId } from '../../lib/tokens';
import type {
  CreateDescriptorPullRequestPlan,
  GitPullRequestRef,
  GitPullRequestStatus,
} from './git-source-provider.types';
import type { GitLabHttpClient } from './gitlab-http.adapter';

interface GitLabMergeRequest {
  iid: number;
  merged_at?: string | null | undefined;
  state: 'closed' | 'locked' | 'merged' | 'opened';
  web_url: string;
}
const mergeRequestSchema: z.ZodType<GitLabMergeRequest> = z
  .object({
    iid: z.number(),
    merged_at: z.string().nullable().optional(),
    state: z.enum(['closed', 'locked', 'merged', 'opened']),
    web_url: z.string(),
  })
  .passthrough();

export async function createGitLabDescriptorMergeRequest(
  client: GitLabHttpClient,
  projectId: string,
  plan: CreateDescriptorPullRequestPlan,
): Promise<GitPullRequestRef> {
  const branch: string = `compartment/add-descriptor-${createId('gbr')}`;
  await createDescriptorBranch(client, projectId, branch, plan.baseBranchName);
  try {
    await commitDescriptorFiles(client, projectId, branch, plan);
    const mr: GitLabMergeRequest = await openDescriptorMergeRequest(client, projectId, branch, plan);
    return { htmlUrl: mr.web_url, number: mr.iid, state: 'open' };
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Unknown GitLab merge request failure.');
    await removeFailedGitLabMergeRequestBranch(client, projectId, branch, failure);
    throw error;
  }
}

async function removeFailedGitLabMergeRequestBranch(
  client: GitLabHttpClient,
  projectId: string,
  branch: string,
  failure: Error,
): Promise<void> {
  try {
    await client.request({
      method: 'DELETE',
      path: `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`,
    });
  } catch (cleanupError) {
    throw new AggregateError(
      [failure, cleanupError],
      'GitLab merge request failed and its branch could not be removed.',
    );
  }
}

async function createDescriptorBranch(
  client: GitLabHttpClient,
  projectId: string,
  branch: string,
  baseBranchName: string,
): Promise<void> {
  await client.request({
    body: { branch, ref: baseBranchName },
    method: 'POST',
    path: `/projects/${projectId}/repository/branches`,
  });
}

async function commitDescriptorFiles(
  client: GitLabHttpClient,
  projectId: string,
  branch: string,
  plan: CreateDescriptorPullRequestPlan,
): Promise<void> {
  await client.request({
    body: {
      actions: plan.files.map(
        (file: GitDescriptorDraftFile): Record<string, string> => ({
          action: 'create',
          content: file.content,
          file_path: file.path,
        }),
      ),
      branch,
      commit_message: `Add Compartment descriptor for ${plan.projectName}`,
    },
    method: 'POST',
    path: `/projects/${projectId}/repository/commits`,
  });
}

async function openDescriptorMergeRequest(
  client: GitLabHttpClient,
  projectId: string,
  branch: string,
  plan: CreateDescriptorPullRequestPlan,
): Promise<GitLabMergeRequest> {
  return mergeRequestSchema.parse(
    await client.request({
      body: {
        description: `Adds ${plan.descriptorPath}.`,
        source_branch: branch,
        target_branch: plan.baseBranchName,
        title: `Add Compartment descriptor for ${plan.projectName}`,
      },
      method: 'POST',
      path: `/projects/${projectId}/merge_requests`,
    }),
  );
}

export async function readGitLabMergeRequestStatus(
  client: GitLabHttpClient,
  projectId: string,
  iid: number,
): Promise<GitPullRequestStatus> {
  const mr: GitLabMergeRequest = mergeRequestSchema.parse(
    await client.request({ path: `/projects/${projectId}/merge_requests/${String(iid)}` }),
  );
  return {
    htmlUrl: mr.web_url,
    merged: mr.state === 'merged' || mr.merged_at != null,
    state: mr.state === 'opened' ? 'open' : 'closed',
  };
}
