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
import { ZodError, type ZodIssue } from 'zod';
import { findGitRepositoryRoot } from './git-repository.service';
import { findNearestProjectScopeRoot } from './project-state-scope.service';
import type { StoredProjectDescriptor } from './project-descriptor.types';

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
    throw formatDescriptorSchemaError(schemaError, compartmentDescriptorFileName);
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
    throw formatDescriptorSchemaError(schemaError, compartmentRoutesFileName);
  }
}

function formatDescriptorSchemaError(error: Error, fileName: string): Error {
  if (!(error instanceof ZodError)) {
    return error;
  }

  const issues: string[] = listDetailedDescriptorIssues(error.issues).map(
    (issue: ZodIssue): string => `${fileName}: ${formatDescriptorFieldPath(issue.path)}: ${issue.message}`,
  );
  return new Error(issues.join('\n'));
}

function listDetailedDescriptorIssues(issues: ZodIssue[]): ZodIssue[] {
  return issues.flatMap((issue: ZodIssue): ZodIssue[] => {
    if (issue.code !== 'invalid_union') {
      return [issue];
    }

    return issue.unionErrors
      .map((unionError: ZodError): ZodIssue[] => listDetailedDescriptorIssues(unionError.issues))
      .sort(
        (left: ZodIssue[], right: ZodIssue[]): number =>
          descriptorIssueDetailScore(right) - descriptorIssueDetailScore(left),
      )[0]!;
  });
}

function descriptorIssueDetailScore(issues: ZodIssue[]): number {
  return issues.reduce((score: number, issue: ZodIssue): number => score + issue.path.length, 0);
}

function formatDescriptorFieldPath(path: (number | string)[]): string {
  if (path.length === 0) {
    return '(root)';
  }

  return path.reduce(
    (formattedPath: string, segment: number | string): string =>
      typeof segment === 'number'
        ? `${formattedPath}[${String(segment)}]`
        : appendDescriptorFieldPathSegment(formattedPath, segment),
    '',
  );
}

function appendDescriptorFieldPathSegment(formattedPath: string, segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(segment)) {
    return `${formattedPath}${formattedPath === '' ? '' : '.'}${segment}`;
  }

  return `${formattedPath}[${JSON.stringify(segment)}]`;
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
