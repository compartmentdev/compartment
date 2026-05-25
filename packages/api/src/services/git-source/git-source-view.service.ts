import { listSourceExcludedDescriptorsBySourceIds } from '../../queries/source-exclusion.query';
import { listActiveBindingsBySourceIds, listBranchMappingsByBindingIds } from '../../queries/source.query';
import type {
  SourceBindingBranchMappingRow,
  SourceBindingRow,
  SourceExcludedDescriptorRow,
  SourceRow,
} from '../../queries/source.query.types';
import {
  findLatestSourceSyncTaskBySourceIdWithExecutor,
  listSourceSyncTaskCandidatesByTaskIdWithExecutor,
} from '../../queries/source-sync.query';
import type { SourceSyncTaskCandidateRow, SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import { hasText } from '@compartment/utils';
import { getApiDatabase } from '../../runtime/runtime-access';
import type {
  GitSourceBindingView,
  GitSourceExclusionView,
  GitSourceDetailsSummaryView,
  GitSourceSettingsView,
  GitSourceSummaryView,
  GitSourceView,
} from './git-source.service.types';
import { buildGitSourceSyncTaskView } from './git-source-sync.view.service';

export async function buildGitSourceView(source: SourceRow): Promise<GitSourceView> {
  const bindings: SourceBindingRow[] = await listActiveBindingsBySourceIds([source.id]);
  const branchMappings: SourceBindingBranchMappingRow[] = await listBranchMappingsByBindingIds(
    bindings.map((binding: SourceBindingRow): string => binding.id),
  );
  const exclusions: SourceExcludedDescriptorRow[] = await readGitSourceExclusions(source.id);
  const latestSync: SourceSyncTaskRow | undefined = await findLatestSourceSyncTaskBySourceIdWithExecutor(
    getApiDatabase(),
    source.id,
  );

  return {
    bindings: bindings.map(
      (binding: SourceBindingRow): GitSourceBindingView => buildGitSourceBindingSummary(binding, branchMappings),
    ),
    source: await buildGitSourceDetailsSummary(source, exclusions, latestSync),
  };
}

async function buildGitSourceDetailsSummary(
  source: SourceRow,
  exclusions: readonly SourceExcludedDescriptorRow[],
  latestSync: SourceSyncTaskRow | undefined,
): Promise<GitSourceDetailsSummaryView> {
  const candidates: SourceSyncTaskCandidateRow[] =
    latestSync === undefined
      ? []
      : await listSourceSyncTaskCandidatesByTaskIdWithExecutor(getApiDatabase(), latestSync.id);

  return {
    ...buildGitSourceSummary(source),
    autoAdoptNewApps: source.autoAdoptNewApps,
    defaultAutoDeployEnabled: source.defaultAutoDeployEnabled,
    defaultEnvironmentName: source.defaultEnvironmentName,
    exclusions: exclusions.map(buildGitSourceExclusionSummary),
    latestSync: latestSync === undefined ? null : buildGitSourceSyncTaskView(latestSync, candidates),
  };
}

export async function buildGitSourceSettingsView(source: SourceRow): Promise<GitSourceSettingsView> {
  return {
    autoAdoptNewApps: source.autoAdoptNewApps,
    exclusions: (await readGitSourceExclusions(source.id)).map(buildGitSourceExclusionSummary),
  };
}

export function buildGitSourceSummary(source: SourceRow): GitSourceSummaryView {
  return {
    defaultBranchName: source.defaultBranchName,
    displayName: source.displayName,
    id: source.id,
    providerHost: source.providerHost,
    repositoryCloneUrl: source.repositoryCloneUrl,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
    status: source.status,
  };
}

export function requireGitProviderField(value: string | null, label: string): string {
  if (!hasText(value)) {
    throw new Error(`Expected provider registration field ${label}.`);
  }

  return value;
}

function buildGitSourceBindingSummary(
  binding: SourceBindingRow,
  mappings: readonly SourceBindingBranchMappingRow[],
): GitSourceBindingView {
  const mapping: SourceBindingBranchMappingRow | undefined = mappings.find(
    (item: SourceBindingBranchMappingRow): boolean => item.sourceBindingId === binding.id,
  );
  if (mapping === undefined) {
    throw new Error(`Expected branch mapping for binding ${binding.id}.`);
  }

  return {
    autoDeployEnabled: binding.autoDeployEnabled,
    branchName: mapping.branchName,
    descriptorPath: binding.descriptorPath,
    environmentName: mapping.environmentName,
    id: binding.id,
    projectId: requireBindingProjectId(binding),
    projectName: binding.projectName,
    status: binding.status,
  };
}

function buildGitSourceExclusionSummary(exclusion: SourceExcludedDescriptorRow): GitSourceExclusionView {
  return {
    descriptorPath: exclusion.descriptorPath,
  };
}

async function readGitSourceExclusions(sourceId: string): Promise<SourceExcludedDescriptorRow[]> {
  return await listSourceExcludedDescriptorsBySourceIds([sourceId]);
}

function requireBindingProjectId(binding: SourceBindingRow): string {
  if (binding.projectId === null) {
    throw new Error(`Expected project id for active source binding ${binding.id}.`);
  }

  return binding.projectId;
}
