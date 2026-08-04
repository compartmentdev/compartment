import type {
  CompartmentAuthoredDescriptor,
  CompartmentRoutesFile,
  CompartmentSourcePackageMetadata,
} from '@compartment/contracts';

export interface SourceArchiveBuilderInput {
  descriptor: CompartmentAuthoredDescriptor;
  descriptorFilePath: string;
  repositoryBoundaryDirectory?: string | undefined;
  routes?: CompartmentRoutesFile | undefined;
  serviceName?: string | undefined;
}

export interface CreatedSourceArchive {
  archiveRoot: string;
  sourceArchive: Buffer;
  sourceDigest: string;
  sourcePackageMetadata: CompartmentSourcePackageMetadata;
}
