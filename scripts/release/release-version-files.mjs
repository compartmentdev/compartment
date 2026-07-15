import { execFile as execFileCallback } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const workspacePackageJsonPathPattern = /^packages\/[^/]+\/package\.json$/;
const execFile = promisify(execFileCallback);

export function readReleaseVersion(value) {
  if (value !== undefined && semverPattern.test(value)) {
    return value;
  }

  throw new Error('Expected a semver release version such as `0.2.0`.');
}

export async function readWorkspacePackageJsonPaths(repositoryRoot) {
  const trackedPackageJsonPaths = await readTrackedWorkspacePackageJsonPaths(repositoryRoot);
  if (trackedPackageJsonPaths !== null) {
    return trackedPackageJsonPaths;
  }

  return await readDirectoryWorkspacePackageJsonPaths(repositoryRoot);
}

async function readTrackedWorkspacePackageJsonPaths(repositoryRoot) {
  try {
    const { stdout } = await execFile('git', ['-C', repositoryRoot, 'ls-files', '--', 'packages'], {
      env: readGitProcessEnv(),
    });
    const paths = stdout
      .split('\n')
      .filter((path) => workspacePackageJsonPathPattern.test(path))
      .sort()
      .map((path) => resolve(repositoryRoot, path));
    const existingPaths = await Promise.all(paths.map(async (path) => ((await pathExists(path)) ? path : undefined)));
    return existingPaths.filter((path) => path !== undefined);
  } catch (error) {
    if (isGitRepositoryError(error)) {
      return null;
    }

    throw error;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function readDirectoryWorkspacePackageJsonPaths(repositoryRoot) {
  const packagesDirectory = resolve(repositoryRoot, 'packages');
  const packageDirectoryEntries = await readdir(packagesDirectory, { withFileTypes: true });

  return packageDirectoryEntries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => resolve(packagesDirectory, entry.name, 'package.json'));
}

function isGitRepositoryError(error) {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return error.code === 128 || error.code === 'ENOENT';
}

function readGitProcessEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  delete env.GIT_WORK_TREE;
  return env;
}

export async function readPackageVersion(packageJsonPath) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const packageVersion = packageJson.version;
  if (typeof packageVersion === 'string' && packageVersion !== '') {
    return packageVersion;
  }

  throw new Error(`Expected ${packageJsonPath} to define a non-empty version.`);
}

export async function readReleasePleaseManifestVersion(repositoryRoot) {
  const manifestPath = resolve(repositoryRoot, '.release-please-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestVersion = manifest['.'];
  if (typeof manifestVersion === 'string' && manifestVersion !== '') {
    return manifestVersion;
  }

  throw new Error('Expected .release-please-manifest.json to define a non-empty "." version.');
}
