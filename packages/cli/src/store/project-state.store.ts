import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listDirectoryLineageWithinBoundary, pathExists } from '../services/directory-lineage.service';
import { findGitRepositoryRoot, toRepositoryRelativePath } from '../services/git-repository.service';
import type { ProjectStateGitIgnoreWritePlan, ProjectStateWritePlan, StoredProjectState } from './project-state.types';
import {
  assertRepositoryTextFileWritable,
  updateRepositoryTextFile,
  writeRepositoryTextFile,
} from './repository-file.store';

const projectStateFilePath: readonly string[] = ['.compartment', 'state.json'];
const projectStateGitIgnoreEntry: string = '.compartment/state.json';

export async function findStoredProjectState(cwd: string): Promise<StoredProjectState | undefined> {
  try {
    return JSON.parse(await readFile(readProjectStateFilePath(cwd), 'utf8')) as StoredProjectState;
  } catch (error) {
    const readError: NodeJS.ErrnoException | Error =
      error instanceof Error ? error : new Error('Failed to read .compartment/state.json.');
    if (isMissingStateError(readError)) {
      return undefined;
    }

    throw readError;
  }
}

export async function writeStoredProjectState(cwd: string, state: StoredProjectState): Promise<void> {
  const filePath: string = readProjectStateFilePath(cwd);
  const writePlan: ProjectStateWritePlan = await createProjectStateWritePlan(cwd, filePath);

  await assertProjectStateWritePlanWritable(writePlan);
  await writeProjectStateFile(writePlan, state);
  if (writePlan.gitIgnorePlan !== undefined) {
    await ensureProjectStateIgnored(writePlan.gitIgnorePlan);
  }
}

export function readProjectStateFilePath(cwd: string): string {
  return join(cwd, ...projectStateFilePath);
}

async function createProjectStateWritePlan(cwd: string, filePath: string): Promise<ProjectStateWritePlan> {
  const gitRoot: string | undefined = await findGitRepositoryRoot(cwd);
  const repositoryRoot: string = gitRoot ?? cwd;
  const gitIgnorePlan: ProjectStateGitIgnoreWritePlan | undefined = await createProjectStateGitIgnoreWritePlan(
    cwd,
    filePath,
    gitRoot,
  );

  return {
    filePath,
    ...(gitIgnorePlan !== undefined ? { gitIgnorePlan } : {}),
    repositoryRoot,
  };
}

async function assertProjectStateWritePlanWritable(writePlan: ProjectStateWritePlan): Promise<void> {
  await assertRepositoryTextFileWritable({
    filePath: writePlan.filePath,
    label: 'Project state file',
    repositoryRoot: writePlan.repositoryRoot,
  });
  if (writePlan.gitIgnorePlan !== undefined) {
    await assertRepositoryTextFileWritable({
      filePath: writePlan.gitIgnorePlan.filePath,
      label: '.gitignore',
      repositoryRoot: writePlan.gitIgnorePlan.repositoryRoot,
    });
  }
}

async function writeProjectStateFile(writePlan: ProjectStateWritePlan, state: StoredProjectState): Promise<void> {
  await writeRepositoryTextFile({
    contents: `${JSON.stringify(state, null, 2)}\n`,
    filePath: writePlan.filePath,
    label: 'Project state file',
    repositoryRoot: writePlan.repositoryRoot,
  });
}

async function createProjectStateGitIgnoreWritePlan(
  stateRoot: string,
  stateFilePath: string,
  gitRoot: string | undefined,
): Promise<ProjectStateGitIgnoreWritePlan | undefined> {
  if (gitRoot === undefined) {
    return undefined;
  }

  const gitIgnoreRoot: string = await findNearestGitIgnoreRoot(stateRoot, gitRoot);
  const gitIgnorePath: string = join(gitIgnoreRoot, '.gitignore');
  return {
    entry: toGitIgnoreEntry(gitIgnoreRoot, stateFilePath),
    filePath: gitIgnorePath,
    repositoryRoot: gitRoot,
  };
}

async function ensureProjectStateIgnored(plan: ProjectStateGitIgnoreWritePlan): Promise<void> {
  await updateRepositoryTextFile({
    filePath: plan.filePath,
    label: '.gitignore',
    repositoryRoot: plan.repositoryRoot,
    update: (currentGitIgnore: string): string | undefined =>
      hasGitIgnoreEntry(currentGitIgnore, plan.entry) ? undefined : appendGitIgnoreEntry(currentGitIgnore, plan.entry),
  });
}

async function findNearestGitIgnoreRoot(stateRoot: string, gitRoot: string): Promise<string> {
  for (const directory of listDirectoryLineageWithinBoundary(stateRoot, gitRoot)) {
    if (await pathExists(join(directory, '.gitignore'))) {
      return directory;
    }
  }

  return stateRoot;
}

function toGitIgnoreEntry(gitIgnoreRoot: string, stateFilePath: string): string {
  const relativePath: string = toRepositoryRelativePath(gitIgnoreRoot, stateFilePath);
  return relativePath === projectStateGitIgnoreEntry ? projectStateGitIgnoreEntry : relativePath;
}

function hasGitIgnoreEntry(content: string, expectedEntry: string): boolean {
  return content
    .split(/\r?\n/u)
    .some((line: string): boolean => line.trim() === expectedEntry || line.trim() === `/${expectedEntry}`);
}

function appendGitIgnoreEntry(content: string, entry: string): string {
  const separator: string = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${entry}\n`;
}

function isMissingStateError(error: NodeJS.ErrnoException | Error): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
