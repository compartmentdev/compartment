import type { GitProviderType } from '@compartment/contracts';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import type { OrganizationRow } from '../../queries/organizations.query.types';
import type { SourceBindingBranchMappingRow, SourceBindingRow, SourceRow } from '../../queries/source.query.types';
import type { SourceResolutionTaskRow } from '../../queries/source-resolution.query.types';
import { getGitProviderAdapter } from './git-source-provider.registry';

const automationPrincipalEmailDomain: string = 'compartment.internal';

interface ClaimedTaskProviderFields {
  providerType: GitProviderType;
  repositoryExternalId: string;
}

export function buildClaimedTaskProviderFields(
  registration: GitProviderRegistrationRow,
  source: SourceRow,
): ClaimedTaskProviderFields {
  const providerType: GitProviderType = getGitProviderAdapter(registration.providerType).providerType;
  return { providerType, repositoryExternalId: source.repositoryExternalId };
}

export function buildSourceAutomationPrincipalEmail(sourceId: string): string {
  return `git-source+${sourceId}@${automationPrincipalEmailDomain}`;
}

export function buildSourceAutomationPrincipalId(sourceId: string): string {
  return `prn_git_${sourceId}`;
}

export function buildSourceAutomationMembershipId(sourceId: string): string {
  return `mem_git_${sourceId}`;
}

export function isSourceResolutionTaskStillDeployable(
  binding: SourceBindingRow,
  branchMappings: readonly SourceBindingBranchMappingRow[],
  task: SourceResolutionTaskRow,
): boolean {
  return (
    binding.projectId !== null &&
    binding.autoDeployEnabled &&
    branchMappings.some(
      (mapping: SourceBindingBranchMappingRow): boolean =>
        mapping.branchName === task.branchName && mapping.environmentName === task.targetEnvironmentName,
    )
  );
}

export function serializeSourceRepositorySnapshot(source: SourceRow, task: SourceResolutionTaskRow): string {
  return JSON.stringify({
    commitSha: task.commitSha,
    providerHost: source.providerHost,
    providerInstallationId: source.providerInstallationId,
    repositoryExternalId: source.repositoryExternalId,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
  });
}

export function serializeSourceBindingSnapshot(
  binding: SourceBindingRow,
  task: SourceResolutionTaskRow,
  watchPaths: readonly string[],
): string {
  return JSON.stringify({
    autoDeployEnabled: binding.autoDeployEnabled,
    branchName: task.branchName,
    descriptorDirectory: binding.descriptorDirectory,
    descriptorPath: binding.descriptorPath,
    environmentName: task.targetEnvironmentName,
    projectId: binding.projectId,
    projectName: binding.projectName,
    watchPaths,
  });
}

export function requireSourceResolutionTask(task: SourceResolutionTaskRow | undefined): SourceResolutionTaskRow {
  if (task === undefined) {
    throw new Error('Source resolution task was not found.');
  }

  return task;
}

export function requireActiveSource(source: SourceRow | undefined): SourceRow {
  if (source?.status !== 'active') {
    throw new Error('Source resolution task source is no longer active.');
  }

  return source;
}

export function requireActiveBinding(binding: SourceBindingRow | undefined): SourceBindingRow {
  if (binding?.status !== 'active') {
    throw new Error('Source resolution task binding is no longer active.');
  }

  return binding;
}

export function requireOrganization(organization: OrganizationRow | undefined): OrganizationRow {
  if (organization === undefined) {
    throw new Error('Source organization was not found.');
  }

  return organization;
}
