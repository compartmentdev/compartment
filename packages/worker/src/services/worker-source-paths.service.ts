import { relative, resolve } from 'node:path';
import {
  joinCompartmentSourcePackageRelativePath,
  readCompartmentSourcePackageBuildContextArchivePath,
  readCompartmentSourcePackageServiceArchivePath,
  type CompartmentSourcePackageMetadata,
} from '@compartment/contracts';
import {
  validateSymlinkFreeFileSystemDirectory,
  validateSymlinkFreeFileSystemEntry,
  type ValidatedFileSystemEntry,
} from '@compartment/utils';
import type { PreparedSourcePaths, PrepareSourcePathsInput } from './worker-source-paths.service.types';

export async function prepareSourcePaths(
  input: PrepareSourcePathsInput,
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): Promise<PreparedSourcePaths> {
  const serviceDirectory: ValidatedFileSystemEntry = await readValidatedServiceDirectory(input, sourcePackageMetadata);
  await validateIncludedBuildPaths(input, sourcePackageMetadata);
  const buildContextDirectory: ValidatedFileSystemEntry = await readValidatedBuildContextDirectory(
    input,
    sourcePackageMetadata,
  );

  return createPreparedSourcePaths(serviceDirectory, buildContextDirectory);
}

async function readValidatedServiceDirectory(
  input: PrepareSourcePathsInput,
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): Promise<ValidatedFileSystemEntry> {
  const serviceArchivePath: string = readCompartmentSourcePackageServiceArchivePath(
    input.servicePath,
    sourcePackageMetadata,
  );

  return await validateSymlinkFreeFileSystemEntry({
    absolutePath: resolve(input.extractionDirectory, serviceArchivePath),
    authoredPath: input.servicePath,
    boundaryDirectory: input.extractionDirectory,
    boundaryLabel: 'the uploaded source archive',
    expectedKind: 'directory',
    label: 'Service path',
    missingMessage: `Service directory "${input.servicePath}" does not exist in the uploaded source archive.`,
    relativeToLabel: 'the uploaded source archive root',
  });
}

async function validateIncludedBuildPaths(
  input: PrepareSourcePathsInput,
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): Promise<void> {
  for (const includePath of input.includePaths) {
    await validateIncludedBuildPath(input, sourcePackageMetadata, includePath);
  }
}

async function validateIncludedBuildPath(
  input: PrepareSourcePathsInput,
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
  includePath: string,
): Promise<void> {
  const includeArchivePath: string = joinCompartmentSourcePackageRelativePath(
    sourcePackageMetadata.descriptorDirectoryRelativePath,
    includePath,
  );

  await validateSymlinkFreeFileSystemEntry({
    absolutePath: resolve(input.extractionDirectory, includeArchivePath),
    authoredPath: includePath,
    boundaryDirectory: input.extractionDirectory,
    boundaryLabel: 'the uploaded source archive',
    expectedKind: 'any',
    label: 'build.include path',
    missingMessage: `build.include path "${includePath}" does not exist in the uploaded source archive.`,
    relativeToLabel: 'the uploaded source archive',
  });
}

async function readValidatedBuildContextDirectory(
  input: PrepareSourcePathsInput,
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): Promise<ValidatedFileSystemEntry> {
  const buildContextArchivePath: string = readCompartmentSourcePackageBuildContextArchivePath(
    input.servicePath,
    input.includePaths,
    sourcePackageMetadata,
  );

  return await validateSymlinkFreeFileSystemDirectory({
    absolutePath: resolve(input.extractionDirectory, buildContextArchivePath),
    authoredPath: buildContextArchivePath,
    boundaryDirectory: input.extractionDirectory,
    boundaryLabel: 'the uploaded source archive',
    label: `Build context for service "${input.servicePath}"`,
    relativeToLabel: 'the uploaded source archive',
  });
}

function createPreparedSourcePaths(
  serviceDirectory: ValidatedFileSystemEntry,
  buildContextDirectory: ValidatedFileSystemEntry,
): PreparedSourcePaths {
  return {
    buildContextDirectory: buildContextDirectory.absolutePath,
    serviceDirectory: serviceDirectory.absolutePath,
    serviceRelativePath: readServicePathFromBuildContext(
      buildContextDirectory.absolutePath,
      serviceDirectory.absolutePath,
    ),
  };
}

function readServicePathFromBuildContext(buildContextDirectory: string, serviceDirectory: string): string {
  const serviceRelativePath: string = relative(buildContextDirectory, serviceDirectory);
  return serviceRelativePath === '' ? '.' : joinCompartmentSourcePackageRelativePath('.', serviceRelativePath);
}
