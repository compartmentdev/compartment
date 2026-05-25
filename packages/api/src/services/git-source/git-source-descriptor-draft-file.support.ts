import type { GitDescriptorDraftFile } from '@compartment/contracts';

export function sortGitDescriptorDraftFiles(files: readonly GitDescriptorDraftFile[]): GitDescriptorDraftFile[] {
  return [...files].sort(compareGitDescriptorDraftFiles);
}

function compareGitDescriptorDraftFiles(left: GitDescriptorDraftFile, right: GitDescriptorDraftFile): number {
  if (left.path === right.path) {
    return left.content.localeCompare(right.content);
  }

  return left.path.localeCompare(right.path);
}
