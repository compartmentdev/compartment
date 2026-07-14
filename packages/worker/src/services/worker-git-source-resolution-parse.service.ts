import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { YAMLParseError } from 'yaml';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import {
  compartmentAuthoredDescriptorSchema,
  compartmentRoutesFileName,
  compartmentRoutesFileSchema,
  joinCompartmentSourcePackageRelativePath,
  readGitSourceDescriptorProjectMismatchMessage,
  readGitSourceDescriptorDirectory,
  type CompartmentAuthoredDescriptor,
  type CompartmentRoutesFile,
} from '@compartment/contracts';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { parseGitSourceYaml } from './worker-git-source-yaml.service';
import { createNonRetryableGitSourceTaskError } from './worker-git-source-resolution-failure.support';

export interface ParsedGitSourceDescriptorFiles {
  descriptor: CompartmentAuthoredDescriptor;
  routes?: CompartmentRoutesFile | undefined;
}

export async function readGitSourceDescriptorFiles(
  repositoryRoot: string,
  descriptorPath: string,
): Promise<ParsedGitSourceDescriptorFiles> {
  const descriptor: CompartmentAuthoredDescriptor = await readGitSourceDescriptorAtPath(repositoryRoot, descriptorPath);
  const routes: CompartmentRoutesFile | undefined = await readOptionalGitSourceRoutesAtPath(
    repositoryRoot,
    descriptorPath,
  );

  return {
    descriptor,
    ...(routes !== undefined ? { routes } : {}),
  };
}

export function requireMatchingDescriptorProjectName(
  descriptor: CompartmentAuthoredDescriptor,
  expectedProjectName: string,
  descriptorPath: string,
): void {
  if (descriptor.name === expectedProjectName) {
    return;
  }

  throw createNonRetryableGitSourceTaskError(
    readGitSourceDescriptorProjectMismatchMessage(descriptorPath, descriptor.name, expectedProjectName),
  );
}

async function readGitSourceDescriptorAtPath(
  repositoryRoot: string,
  descriptorPath: string,
): Promise<CompartmentAuthoredDescriptor> {
  const descriptorFilePath: string = join(repositoryRoot, descriptorPath);
  return readParsedGitSourceYamlAtPath(
    await readRequiredDescriptorFile(descriptorFilePath, descriptorPath),
    'Descriptor',
    descriptorPath,
    compartmentAuthoredDescriptorSchema,
  );
}

async function readOptionalGitSourceRoutesAtPath(
  repositoryRoot: string,
  descriptorPath: string,
): Promise<CompartmentRoutesFile | undefined> {
  const routesRelativePath: string = joinCompartmentSourcePackageRelativePath(
    readGitSourceDescriptorDirectory(descriptorPath),
    compartmentRoutesFileName,
  );
  const routesFilePath: string = join(repositoryRoot, routesRelativePath);
  if (!(await hasRoutesFile(routesFilePath))) {
    return undefined;
  }

  return readParsedGitSourceYamlAtPath(
    await readFile(routesFilePath, 'utf8'),
    'Routes file',
    routesRelativePath,
    compartmentRoutesFileSchema,
  );
}

async function readRequiredDescriptorFile(descriptorFilePath: string, descriptorPath: string): Promise<string> {
  try {
    return await readFile(descriptorFilePath, 'utf8');
  } catch (error) {
    const fileError: Error | undefined = error instanceof Error ? error : undefined;
    if (fileError !== undefined && isMissingFileSystemEntryError(fileError)) {
      throw createNonRetryableGitSourceTaskError(`Descriptor ${descriptorPath} was not found on the source branch.`);
    }

    throw error;
  }
}

function readParsedGitSourceYamlAtPath<TOutput, TInput>(
  contents: string,
  fileLabel: 'Descriptor' | 'Routes file',
  relativePath: string,
  schema: ZodType<TOutput, ZodTypeDef, TInput>,
): TOutput {
  try {
    return schema.parse(parseGitSourceYaml(contents));
  } catch (error) {
    const parseError: Error | undefined = error instanceof Error ? error : undefined;
    const failureMessage: string | null = readDeterministicParseFailureMessage(parseError);
    if (failureMessage === null) {
      throw error;
    }

    throw createNonRetryableGitSourceTaskError(`${fileLabel} ${relativePath} is invalid: ${failureMessage}`);
  }
}

function readDeterministicParseFailureMessage(error: Error | undefined): string | null {
  return error instanceof YAMLParseError || error instanceof ZodError ? error.message : null;
}

async function hasRoutesFile(routesFilePath: string): Promise<boolean> {
  try {
    await access(routesFilePath);
    return true;
  } catch {
    return false;
  }
}
