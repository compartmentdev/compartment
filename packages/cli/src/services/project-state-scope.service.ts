import { join, resolve } from 'node:path';
import { compartmentDescriptorFileName } from '@compartment/contracts';
import { findStoredProjectState, readProjectStateFilePath } from '../store/project-state.store';
import type { StoredProjectState } from '../store/project-state.types';
import { listDirectoryLineage, listDirectoryLineageWithinBoundary, pathExists } from './directory-lineage.service';
import { findGitRepositoryRoot } from './git-repository.service';
import type { ProjectStateScope, StoredProjectStateReference } from './project-state-scope.service.types';

export async function resolveProjectStateWriteRoot(cwd: string): Promise<string | undefined> {
  const scope: ProjectStateScope = await resolveProjectStateScope(cwd);
  return scope.projectRoot ?? scope.gitRoot;
}

export async function resolveProjectStateScope(cwd: string): Promise<ProjectStateScope> {
  const normalizedCwd: string = resolve(cwd);
  const gitRoot: string | undefined = await findGitRepositoryRoot(normalizedCwd);
  const projectRoot: string | undefined = await findNearestProjectScopeRoot(normalizedCwd, gitRoot);
  const projectState: StoredProjectStateReference | undefined = await findStoredProjectStateReference(projectRoot);
  const repoState: StoredProjectStateReference | undefined =
    gitRoot !== undefined && gitRoot !== projectRoot ? await findStoredProjectStateReference(gitRoot) : undefined;
  const effectiveState: StoredProjectStateReference | undefined = projectState ?? repoState;

  return {
    ...(effectiveState !== undefined ? { effectiveState } : {}),
    ...(gitRoot !== undefined ? { gitRoot } : {}),
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    ...(projectState !== undefined ? { projectState } : {}),
    ...(repoState !== undefined ? { repoState } : {}),
  };
}

export async function findNearestProjectScopeRoot(
  startDirectory: string,
  stopDirectory?: string,
): Promise<string | undefined> {
  return await findNearestMarkerRoot(startDirectory, compartmentDescriptorFileName, stopDirectory);
}

async function findNearestMarkerRoot(
  startDirectory: string,
  marker: string,
  stopDirectory?: string,
): Promise<string | undefined> {
  const normalizedStartDirectory: string = resolve(startDirectory);
  const lineage: string[] =
    stopDirectory !== undefined
      ? listDirectoryLineageWithinBoundary(normalizedStartDirectory, resolve(stopDirectory))
      : listDirectoryLineage(normalizedStartDirectory);
  for (const directory of lineage) {
    if (await pathExists(join(directory, marker))) {
      return directory;
    }
  }

  return undefined;
}

async function findStoredProjectStateReference(
  root: string | undefined,
): Promise<StoredProjectStateReference | undefined> {
  if (root === undefined) {
    return undefined;
  }

  const state: StoredProjectState | undefined = await findStoredProjectState(root);
  if (state === undefined) {
    return undefined;
  }

  return {
    filePath: readProjectStateFilePath(root),
    root,
    state,
  };
}
