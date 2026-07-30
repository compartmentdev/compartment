import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  compartmentDescriptorFileName,
  compartmentAuthoredDescriptorSchema,
  compartmentRoutesFileName,
  compartmentRoutesFileSchema,
  type CompartmentAuthoredDescriptor,
  type CompartmentRoutesFile,
} from '@compartment/contracts';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { parse } from 'yaml';
import { findGitRepositoryRoot } from './git-repository.service';
import { findNearestProjectScopeRoot } from './project-state-scope.service';
import type { StoredProjectDescriptor } from './project-descriptor.types';
import { formatSchemaValidationError } from './schema-validation-error';

type ParsedYamlDescriptor = ParsedYamlObject | ParsedYamlPrimitive | ParsedYamlDescriptor[];
interface ParsedYamlObject {
  [key: string]: ParsedYamlDescriptor;
}
type ParsedYamlPrimitive = boolean | null | number | string;

export async function findStoredProjectDescriptor(cwd: string): Promise<StoredProjectDescriptor | undefined> {
  try {
    return await readStoredProjectDescriptor(cwd);
  } catch (error) {
    const descriptorError: Error | NodeJS.ErrnoException =
      error instanceof Error ? error : new Error('Failed to read compartment.yml.');
    if (isMissingDescriptorError(descriptorError)) {
      return undefined;
    }

    throw descriptorError;
  }
}

async function readStoredProjectDescriptor(cwd: string): Promise<StoredProjectDescriptor> {
  const gitRoot: string | undefined = await findGitRepositoryRoot(cwd);
  const descriptorRoot: string | undefined = await findNearestProjectScopeRoot(cwd, gitRoot);
  const filePath: string = join(descriptorRoot ?? cwd, compartmentDescriptorFileName);
  return await readStoredProjectDescriptorAtPath(filePath, gitRoot);
}

async function readStoredProjectDescriptorAtPath(
  filePath: string,
  repositoryRoot: string | undefined,
): Promise<StoredProjectDescriptor> {
  const descriptor: CompartmentAuthoredDescriptor = await readStoredAuthoredDescriptorAtPath(filePath);
  const routes: CompartmentRoutesFile | undefined = await findStoredCompartmentRoutes(dirname(filePath));

  return {
    descriptor,
    filePath,
    ...(repositoryRoot !== undefined ? { repositoryRoot } : {}),
    ...(routes !== undefined ? { routes } : {}),
  };
}

async function readStoredAuthoredDescriptorAtPath(filePath: string): Promise<CompartmentAuthoredDescriptor> {
  const fileContents: string = await readFile(filePath, 'utf8');
  return parseCompartmentDescriptor(fileContents);
}

function parseCompartmentDescriptor(fileContents: string): CompartmentAuthoredDescriptor {
  const parsedDescriptor: ParsedYamlDescriptor = parseYamlDescriptor(fileContents, compartmentDescriptorFileName);
  try {
    return compartmentAuthoredDescriptorSchema.parse(parsedDescriptor);
  } catch (error) {
    const schemaError: Error =
      error instanceof Error ? error : new Error(`${compartmentDescriptorFileName} is invalid.`);
    throw formatSchemaValidationError(schemaError, compartmentDescriptorFileName);
  }
}

async function findStoredCompartmentRoutes(cwd: string): Promise<CompartmentRoutesFile | undefined> {
  try {
    const filePath: string = join(cwd, compartmentRoutesFileName);
    const fileContents: string = await readFile(filePath, 'utf8');

    return parseCompartmentRoutes(fileContents);
  } catch (error) {
    const routesError: Error | NodeJS.ErrnoException =
      error instanceof Error ? error : new Error('Failed to read compartment.routes.yml.');
    if (isMissingDescriptorError(routesError)) {
      return undefined;
    }

    throw routesError;
  }
}

function parseCompartmentRoutes(fileContents: string): CompartmentRoutesFile {
  const parsedRoutes: ParsedYamlDescriptor = parseYamlDescriptor(fileContents, compartmentRoutesFileName);
  try {
    return compartmentRoutesFileSchema.parse(parsedRoutes);
  } catch (error) {
    const schemaError: Error = error instanceof Error ? error : new Error(`${compartmentRoutesFileName} is invalid.`);
    throw formatSchemaValidationError(schemaError, compartmentRoutesFileName);
  }
}

function parseYamlDescriptor(fileContents: string, fileName: string): ParsedYamlDescriptor {
  try {
    return parse(fileContents) as ParsedYamlDescriptor;
  } catch (error) {
    const parseError: Error = error instanceof Error ? error : new Error(`${fileName} contains invalid YAML.`);
    throw new Error(`Failed to parse ${fileName}: ${parseError.message}`);
  }
}

function isMissingDescriptorError(error: NodeJS.ErrnoException | Error): error is NodeJS.ErrnoException {
  return error instanceof Error && isMissingFileSystemEntryError(error);
}
