import { z } from 'zod';
import { normalizeRepositoryRelativePath } from './repository-relative-path.contract';
import type { ContractSchema } from './schema.types';

const currentDirectoryPath: string = '.';
const sourcePackageMetadataVersion: 1 = 1;
const absoluteSourcePackagePathPattern: RegExp = /^(?:[A-Za-z]:|[/\\]{1,2})/u;

export interface CompartmentSourcePackageMetadata {
  descriptorDirectoryRelativePath: string;
  servicePaths?: Record<string, string> | undefined;
  version: 1;
}

export const compartmentSourcePackageMetadataArchivePath: string = '.compartment/source-package.json';

const compartmentSourcePackageRelativePathSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .refine(
    (relativePath: string): boolean => isLiteralCompartmentSourcePackageArchiveRelativePath(relativePath),
    'Source-package metadata paths must be literal relative paths.',
  );
const sourcePackageServicePathsSchema: ContractSchema<Record<string, string>> = z.record(
  z
    .string()
    .min(1)
    .refine(
      (relativePath: string): boolean => isLiteralCompartmentSourcePackageDescriptorRelativePath(relativePath),
      'Source-package metadata paths must be literal relative paths.',
    ),
);
const compartmentSourcePackageMetadataSchema: ContractSchema<CompartmentSourcePackageMetadata> = z
  .object({
    descriptorDirectoryRelativePath: compartmentSourcePackageRelativePathSchema,
    servicePaths: sourcePackageServicePathsSchema.optional(),
    version: z.literal(sourcePackageMetadataVersion),
  })
  .strict();

export function parseCompartmentSourcePackageMetadata(fileContents: string): CompartmentSourcePackageMetadata {
  const parsedMetadata: CompartmentSourcePackageMetadata = compartmentSourcePackageMetadataSchema.parse(
    JSON.parse(fileContents),
  );

  return createCompartmentSourcePackageMetadata(
    parsedMetadata.descriptorDirectoryRelativePath,
    parsedMetadata.servicePaths,
  );
}

export function serializeCompartmentSourcePackageMetadata(metadata: CompartmentSourcePackageMetadata): string {
  return `${JSON.stringify(createCompartmentSourcePackageMetadata(metadata.descriptorDirectoryRelativePath, metadata.servicePaths), null, 2)}\n`;
}

export function readCompartmentSourcePackageBuildContextArchivePath(
  servicePath: string,
  includePaths: readonly string[],
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): string {
  return findCommonArchivePath([
    readCompartmentSourcePackageServiceArchivePath(servicePath, sourcePackageMetadata),
    ...includePaths.map((includePath: string): string =>
      joinCompartmentSourcePackageRelativePath(sourcePackageMetadata.descriptorDirectoryRelativePath, includePath),
    ),
  ]);
}

export function readCompartmentSourcePackageServiceArchivePath(
  servicePath: string,
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): string {
  return joinCompartmentSourcePackageRelativePath(sourcePackageMetadata.descriptorDirectoryRelativePath, servicePath);
}

export function readCompartmentSourcePackageValidatedServicePath(
  serviceName: string,
  servicePath: string,
  sourcePackageMetadata: CompartmentSourcePackageMetadata,
): string {
  const metadataServicePath: string | undefined = sourcePackageMetadata.servicePaths?.[serviceName];
  if (metadataServicePath === undefined) {
    return servicePath;
  }
  if (
    normalizeCompartmentSourcePackageRelativePath(metadataServicePath) ===
    normalizeCompartmentSourcePackageRelativePath(servicePath)
  ) {
    return metadataServicePath;
  }

  throw new Error(`Uploaded source archive metadata must not override service path for "${serviceName}".`);
}

export function readCompartmentSourcePackageDockerfilePath(serviceRelativePath: string): string {
  const normalizedServicePath: string = normalizeCompartmentSourcePackageRelativePath(serviceRelativePath);
  return normalizedServicePath === currentDirectoryPath ? 'Dockerfile' : `${normalizedServicePath}/Dockerfile`;
}

export function joinCompartmentSourcePackageRelativePath(basePath: string, relativePath: string): string {
  return normalizeCompartmentSourcePackageRelativePath(`${basePath}/${relativePath}`);
}

export function readCompartmentSourcePackageLiteralArchiveEntryPath(entryPath: string): string {
  if (absoluteSourcePackagePathPattern.test(entryPath)) {
    throw new Error(`Uploaded source archive contains invalid entry path "${entryPath}".`);
  }

  const literalEntryPath: string = stripCompartmentSourcePackageArchiveEntryPath(entryPath);
  const normalizedEntryPath: string = normalizeCompartmentSourcePackageRelativePath(entryPath);
  if (normalizedEntryPath === '..' || normalizedEntryPath.startsWith('../')) {
    throw new Error(`Uploaded source archive contains invalid entry path "${entryPath}".`);
  }
  if (normalizedEntryPath !== literalEntryPath) {
    throw new Error(`Uploaded source archive contains invalid entry path "${entryPath}".`);
  }

  return normalizedEntryPath;
}

export function validateCompartmentSourcePackageArchiveEntryType(entryPath: string, typeIndicator: string): void {
  if (typeIndicator === '-' || typeIndicator === 'd') {
    return;
  }

  throw new Error(`Uploaded source archive contains unsupported entry type for path "${entryPath}".`);
}

function createCompartmentSourcePackageMetadata(
  descriptorDirectoryRelativePath: string,
  servicePaths: Record<string, string> | undefined = undefined,
): CompartmentSourcePackageMetadata {
  const normalizedServicePaths: Record<string, string> | undefined = normalizeSourcePackageServicePaths(servicePaths);

  return {
    descriptorDirectoryRelativePath: normalizeCompartmentSourcePackageRelativePath(descriptorDirectoryRelativePath),
    ...(normalizedServicePaths !== undefined ? { servicePaths: normalizedServicePaths } : {}),
    version: sourcePackageMetadataVersion,
  };
}

function normalizeSourcePackageServicePaths(
  servicePaths: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (servicePaths === undefined) {
    return undefined;
  }

  const normalizedEntries: [string, string][] = Object.entries(servicePaths)
    .sort(([leftName]: [string, string], [rightName]: [string, string]): number => leftName.localeCompare(rightName))
    .map(([serviceName, servicePath]: [string, string]): [string, string] => [
      serviceName,
      normalizeCompartmentSourcePackageRelativePath(servicePath),
    ]);

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

function isLiteralCompartmentSourcePackageArchiveRelativePath(relativePath: string): boolean {
  if (!isLiteralCompartmentSourcePackageDescriptorRelativePath(relativePath)) {
    return false;
  }

  const normalizedPath: string = normalizeCompartmentSourcePackageRelativePath(relativePath);
  return normalizedPath !== '..' && !normalizedPath.startsWith('../');
}

function isLiteralCompartmentSourcePackageDescriptorRelativePath(relativePath: string): boolean {
  if (absoluteSourcePackagePathPattern.test(relativePath)) {
    return false;
  }

  const normalizedPath: string = normalizeCompartmentSourcePackageRelativePath(relativePath);
  return normalizedPath === relativePath;
}

export function isValidCompartmentSourcePackageRelativePath(relativePath: string): boolean {
  if (absoluteSourcePackagePathPattern.test(relativePath)) {
    return false;
  }

  const normalizedPath: string = normalizeCompartmentSourcePackageRelativePath(relativePath);
  return normalizedPath === currentDirectoryPath || (normalizedPath !== '..' && !normalizedPath.startsWith('../'));
}

export function normalizeCompartmentSourcePackageRelativePath(relativePath: string): string {
  const normalizedPath: string = normalizeRepositoryRelativePath(
    relativePath
      .replaceAll('\\', '/')
      .replace(/^\.\/+/u, '')
      .replace(/\/+$/u, ''),
  );

  return normalizedPath === '' ? currentDirectoryPath : normalizedPath;
}

function stripCompartmentSourcePackageArchiveEntryPath(entryPath: string): string {
  const strippedEntryPath: string = entryPath
    .replaceAll('\\', '/')
    .replace(/^\.\/+/u, '')
    .replace(/\/+$/u, '');
  return strippedEntryPath === '' ? currentDirectoryPath : strippedEntryPath;
}

function findCommonArchivePath(paths: readonly string[]): string {
  const [firstPath, ...remainingPaths]: readonly string[] = paths;
  if (firstPath === undefined) {
    return currentDirectoryPath;
  }

  return remainingPaths.reduce(readSharedArchivePath, firstPath);
}

function readSharedArchivePath(leftPath: string, rightPath: string): string {
  const leftSegments: string[] = leftPath === currentDirectoryPath ? [] : leftPath.split('/');
  const rightSegments: string[] = rightPath === currentDirectoryPath ? [] : rightPath.split('/');
  const sharedSegments: string[] = [];
  const segmentCount: number = Math.min(leftSegments.length, rightSegments.length);

  for (let index: number = 0; index < segmentCount; index += 1) {
    if (leftSegments[index] !== rightSegments[index]) {
      break;
    }

    const segment: string | undefined = leftSegments[index];
    if (segment !== undefined) {
      sharedSegments.push(segment);
    }
  }

  return sharedSegments.length === 0 ? currentDirectoryPath : sharedSegments.join('/');
}
