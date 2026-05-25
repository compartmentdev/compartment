import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  joinCompartmentSourcePackageRelativePath,
  type CompartmentServiceKind,
  type CompartmentSourcePackageMetadata,
  readCompartmentSourcePackageDockerfilePath,
  readCompartmentSourcePackageValidatedServicePath,
  resolveCompartmentServiceBuildExecution,
  type ResolvedCompartmentServiceBuildConfig,
  type ResolvedCompartmentServiceBuildExecution,
} from '@compartment/contracts';
import { extractValidatedSourceArchive, readSourcePackageMetadata } from './worker-source-archive.service';
import { prepareSourcePaths } from './worker-source-paths.service';
import type { PreparedSourcePaths } from './worker-source-paths.service.types';
import type {
  PreparedWorkerSourceBuildInput,
  PreparedWorkerSource,
  WorkerSourceServiceInput,
} from './worker-source.service.types';
import { hasDirectoryFile } from './worker-source-file-presence.service';
import { validateWidenedNodeSourceBuildContext } from './worker-source-build-compatibility.service';

interface PreparedServiceBuildInputs extends PreparedSourcePaths {
  dockerfilePresent: boolean;
  servicePath: string;
}

export async function prepareServiceDirectory(
  tempDirectory: string,
  sourceArchive: Buffer,
  service: WorkerSourceServiceInput,
  build: ResolvedCompartmentServiceBuildConfig,
  requireRoutesFile: boolean,
): Promise<PreparedWorkerSource> {
  const archivePath: string = join(tempDirectory, 'source.tgz');
  const extractionDirectory: string = join(tempDirectory, 'src');
  await writeSourceArchive(archivePath, sourceArchive);
  await extractSourceArchive(archivePath, extractionDirectory);

  const preparedInputs: PreparedServiceBuildInputs = await prepareExtractedServiceBuildInputs(
    extractionDirectory,
    service,
    build.include,
    requireRoutesFile,
  );
  const resolvedBuildExecution: PreparedWorkerSource = resolvePreparedWorkerSource(service, build, preparedInputs);
  await validatePreparedWorkerSource(service, preparedInputs, resolvedBuildExecution);

  return resolvedBuildExecution;
}

function resolvePreparedWorkerSource(
  service: WorkerSourceServiceInput,
  build: ResolvedCompartmentServiceBuildConfig,
  preparedInputs: PreparedServiceBuildInputs,
): PreparedWorkerSource {
  const resolvedBuildExecution: ResolvedCompartmentServiceBuildExecution = resolveCompartmentServiceBuildExecution(
    build,
    preparedInputs.dockerfilePresent,
    preparedInputs.servicePath,
    service.kind,
  );

  return {
    ...resolvedBuildExecution,
    buildContextDirectory: preparedInputs.buildContextDirectory,
    ...buildPreparedWorkerDockerfileFields(preparedInputs, resolvedBuildExecution),
    ...buildPreparedWorkerSourceBuildFields(service.kind, preparedInputs.serviceRelativePath, resolvedBuildExecution),
    serviceRelativePath: preparedInputs.serviceRelativePath,
  };
}

async function validatePreparedWorkerSource(
  service: WorkerSourceServiceInput,
  preparedInputs: PreparedServiceBuildInputs,
  resolvedBuildExecution: PreparedWorkerSource,
): Promise<void> {
  await validateWidenedNodeSourceBuildContext({
    buildContextDirectory: preparedInputs.buildContextDirectory,
    packer: resolvedBuildExecution.packer,
    serviceDirectory: preparedInputs.serviceDirectory,
    serviceName: service.name,
    servicePath: service.path,
    serviceRelativePath: preparedInputs.serviceRelativePath,
  });
}

async function writeSourceArchive(archivePath: string, sourceArchive: Buffer): Promise<void> {
  await writeFile(archivePath, sourceArchive);
}

async function extractSourceArchive(archivePath: string, extractionDirectory: string): Promise<void> {
  await extractValidatedSourceArchive(archivePath, extractionDirectory);
}

async function prepareExtractedServiceBuildInputs(
  extractionDirectory: string,
  service: WorkerSourceServiceInput,
  includePaths: readonly string[],
  requireRoutesFile: boolean,
): Promise<PreparedServiceBuildInputs> {
  const sourcePackageMetadata: CompartmentSourcePackageMetadata = await readSourcePackageMetadata(
    extractionDirectory,
    requireRoutesFile,
  );
  const preparedPaths: PreparedSourcePaths = await readPreparedSourcePaths(
    extractionDirectory,
    service,
    includePaths,
    sourcePackageMetadata,
  );
  const dockerfilePresent: boolean = await hasDockerfile(preparedPaths.serviceDirectory);

  return {
    ...preparedPaths,
    dockerfilePresent,
    servicePath: service.path,
  };
}

async function readPreparedSourcePaths(
  extractionDirectory: string,
  service: WorkerSourceServiceInput,
  includePaths: readonly string[],
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): Promise<PreparedSourcePaths> {
  const validatedServicePath: string = readCompartmentSourcePackageValidatedServicePath(
    service.name,
    service.path,
    sourcePackageMetadata,
  );

  return await prepareSourcePaths(
    {
      extractionDirectory,
      includePaths,
      servicePath: validatedServicePath,
    },
    sourcePackageMetadata,
  );
}

async function hasDockerfile(serviceDirectory: string): Promise<boolean> {
  return await hasDirectoryFile(serviceDirectory, 'Dockerfile');
}

function buildPreparedWorkerDockerfileFields(
  preparedInputs: PreparedServiceBuildInputs,
  resolvedBuildExecution: ResolvedCompartmentServiceBuildExecution,
): Partial<Pick<PreparedWorkerSource, 'dockerfilePath'>> {
  return preparedInputs.dockerfilePresent && resolvedBuildExecution.packer === 'dockerfile'
    ? { dockerfilePath: readCompartmentSourcePackageDockerfilePath(preparedInputs.serviceRelativePath) }
    : {};
}

function buildPreparedWorkerSourceBuildFields(
  serviceKind: CompartmentServiceKind,
  serviceRelativePath: string,
  resolvedBuildExecution: ResolvedCompartmentServiceBuildExecution,
): Partial<Pick<PreparedWorkerSource, 'sourceBuildInput'>> {
  return resolvedBuildExecution.packer !== 'dockerfile'
    ? {
        sourceBuildInput: resolvePreparedWorkerSourceBuildInput(
          serviceKind,
          serviceRelativePath,
          resolvedBuildExecution,
        ),
      }
    : {};
}

function resolvePreparedWorkerSourceBuildInput(
  serviceKind: CompartmentServiceKind,
  serviceRelativePath: string,
  resolvedBuildExecution: ResolvedCompartmentServiceBuildExecution,
): PreparedWorkerSourceBuildInput {
  const useContextRoot: boolean = usesWidenedContextRootSourceBuild(serviceRelativePath);
  const staticOutputDirectory: string | undefined = readPreparedWorkerStaticOutputDirectory(
    serviceKind,
    serviceRelativePath,
    resolvedBuildExecution,
    useContextRoot,
  );

  return {
    ...(useContextRoot ? {} : { appPath: serviceRelativePath }),
    ...(staticOutputDirectory !== undefined ? { staticOutputDirectory } : {}),
  };
}

function readPreparedWorkerStaticOutputDirectory(
  serviceKind: CompartmentServiceKind,
  serviceRelativePath: string,
  resolvedBuildExecution: ResolvedCompartmentServiceBuildExecution,
  useContextRoot: boolean,
): string | undefined {
  if (serviceKind !== 'static') {
    return undefined;
  }

  const outputDirectory: string = requirePreparedWorkerStaticOutputDirectory(resolvedBuildExecution);
  return useContextRoot
    ? joinCompartmentSourcePackageRelativePath(serviceRelativePath, outputDirectory)
    : outputDirectory;
}

function requirePreparedWorkerStaticOutputDirectory(
  resolvedBuildExecution: ResolvedCompartmentServiceBuildExecution,
): string {
  if (resolvedBuildExecution.outputDirectory !== undefined) {
    return resolvedBuildExecution.outputDirectory;
  }

  throw new Error('Static services must resolve build.outputDirectory before image build.');
}

function usesWidenedContextRootSourceBuild(serviceRelativePath: string): boolean {
  return serviceRelativePath !== '.';
}
