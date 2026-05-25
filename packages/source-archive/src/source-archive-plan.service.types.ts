import type { CompartmentAuthoredDescriptor, CompartmentRoutesFile } from '@compartment/contracts';

export interface SourceArchiveDescriptorInput {
  descriptor: CompartmentAuthoredDescriptor;
  descriptorFilePath: string;
  routes?: CompartmentRoutesFile | undefined;
}

export interface SelectedSourceArchiveService {
  include: string[];
  name: string;
  path: string;
}

export interface PlannedSourceArchive {
  archiveRoot: string;
  archiveRootRelativeToIgnoreRoot: string;
  descriptorDirectoryRelativePath: string;
  descriptorEntries: string[];
  ignoreRoot: string;
  includeEntries: string[];
  serviceEntries: string[];
  servicePaths: Record<string, string>;
}

export interface ResolvedSourceArchiveTarget {
  absolutePath: string;
}

export interface PlannedSourceArchiveTargets {
  includeTargets: ResolvedSourceArchiveTarget[];
  serviceTargets: ResolvedSourceArchiveTarget[];
}
