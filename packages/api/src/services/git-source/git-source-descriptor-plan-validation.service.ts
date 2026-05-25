import {
  type CreateGitDescriptorPullRequestRequest,
  type GitDescriptorCandidate,
  type GitDescriptorDraftFile,
} from '@compartment/contracts';
import { createGitSourceRequestInvalidError } from '../../errors/api-business-error';
import type { GitHubRepositoryTreeEntry } from './github-app-client.adapter.types';
import { buildDescriptorCandidates, readFirstDescriptorPath } from './git-source-descriptor-candidate.service';
import { sortGitDescriptorDraftFiles } from './git-source-descriptor-draft-file.support';

export function assertDescriptorPullRequestMatchesPlan(
  input: CreateGitDescriptorPullRequestRequest,
  tree: readonly GitHubRepositoryTreeEntry[],
): void {
  if (readFirstDescriptorPath(tree) !== null) {
    throw createGitSourceRequestInvalidError('Descriptor already exists in the selected branch.');
  }
  if (
    buildDescriptorCandidates(input.repositoryName, tree).some((candidate: GitDescriptorCandidate): boolean =>
      doesDescriptorPullRequestMatchCandidate(input, candidate),
    )
  ) {
    return;
  }

  throw createGitSourceRequestInvalidError('Descriptor pull request input does not match the server descriptor plan.');
}

function doesDescriptorPullRequestMatchCandidate(
  input: CreateGitDescriptorPullRequestRequest,
  candidate: GitDescriptorCandidate,
): boolean {
  return (
    input.appFolder === candidate.appFolder &&
    input.descriptorPath === candidate.descriptorPath &&
    hasMatchingDraftFiles(input, candidate) &&
    input.projectName === candidate.projectName
  );
}

function hasMatchingDraftFiles(
  input: CreateGitDescriptorPullRequestRequest,
  candidate: GitDescriptorCandidate,
): boolean {
  const inputFiles: GitDescriptorDraftFile[] = sortGitDescriptorDraftFiles(input.files);
  const candidateFiles: GitDescriptorDraftFile[] = sortGitDescriptorDraftFiles(candidate.files);
  return (
    inputFiles.length === candidateFiles.length &&
    inputFiles.every((file: GitDescriptorDraftFile, index: number): boolean => {
      const candidateFile: GitDescriptorDraftFile = candidateFiles[index]!;
      return file.path === candidateFile.path && file.content === candidateFile.content;
    })
  );
}
