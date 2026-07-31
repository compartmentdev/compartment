import {
  buildDefaultCompartmentAuthoredDescriptor,
  compartmentDescriptorFileName,
  compartmentProjectNameSchema,
  formatCompartmentAuthoredDescriptor,
  type GitDescriptorCandidate,
  type GitDescriptorDraftFile,
} from '@compartment/contracts';
import { slugifyText } from '@compartment/utils';
import type { GitRepositoryTreeEntry } from './git-source-provider.types';

interface PackageJsonDescriptorCandidate {
  appFolder: string;
  packageJsonPath: string | null;
}

const starterAppFilePath: string = 'apps/site/index.html';
const starterMetadataFileBaseNames: readonly string[] = ['.editorconfig', '.gitattributes', '.gitignore'];

export function buildDescriptorCandidates(
  repositoryName: string,
  tree: readonly GitRepositoryTreeEntry[],
): GitDescriptorCandidate[] {
  if (isStarterEligibleRepository(tree)) {
    return [buildStarterDescriptorCandidate(repositoryName)];
  }

  return readPackageJsonDescriptorCandidates(tree).map(
    (candidate: PackageJsonDescriptorCandidate): GitDescriptorCandidate =>
      buildDescriptorCandidate(repositoryName, candidate),
  );
}

export function readFirstDescriptorPath(tree: readonly GitRepositoryTreeEntry[]): string | null {
  return (
    tree
      .filter((entry: GitRepositoryTreeEntry): boolean => entry.type === 'blob')
      .map((entry: GitRepositoryTreeEntry): string => entry.path)
      .filter(
        (path: string): boolean =>
          path === compartmentDescriptorFileName || path.endsWith(`/${compartmentDescriptorFileName}`),
      )
      .sort(compareDescriptorPaths)[0] ?? null
  );
}

function readPackageJsonDescriptorCandidates(
  tree: readonly GitRepositoryTreeEntry[],
): PackageJsonDescriptorCandidate[] {
  const packageJsonPaths: Set<string> = new Set<string>(
    tree
      .filter((entry: GitRepositoryTreeEntry): boolean => entry.type === 'blob')
      .map((entry: GitRepositoryTreeEntry): string => entry.path)
      .filter(isSupportedPackageJsonPath),
  );
  const sortedPaths: string[] = [...packageJsonPaths].sort(comparePackageJsonCandidatePaths);
  return sortedPaths.length > 0
    ? sortedPaths.map(toPackageJsonDescriptorCandidate)
    : [{ appFolder: '.', packageJsonPath: null }];
}

function buildStarterDescriptorCandidate(repositoryName: string): GitDescriptorCandidate {
  const projectName: string = readProjectName(repositoryName, '.');
  return {
    appFolder: '.',
    descriptorPath: compartmentDescriptorFileName,
    files: [
      createDraftFile(compartmentDescriptorFileName, buildStarterDescriptorPreview(projectName)),
      createDraftFile(starterAppFilePath, buildStarterIndexHtml()),
    ],
    id: compartmentDescriptorFileName.replace(/[^a-zA-Z0-9]+/gu, '_'),
    packageJsonPath: null,
    projectName,
  };
}

function buildDescriptorCandidate(
  repositoryName: string,
  candidate: PackageJsonDescriptorCandidate,
): GitDescriptorCandidate {
  const projectName: string = readProjectName(repositoryName, candidate.appFolder);
  const descriptorPath: string = readDescriptorPath(candidate.appFolder);
  return {
    appFolder: candidate.appFolder,
    descriptorPath,
    files: [createDraftFile(descriptorPath, buildDescriptorPreview(projectName))],
    id: descriptorPath.replace(/[^a-zA-Z0-9]+/gu, '_'),
    packageJsonPath: candidate.packageJsonPath,
    projectName,
  };
}

function buildDescriptorPreview(projectName: string): string {
  return formatCompartmentAuthoredDescriptor(buildDefaultCompartmentAuthoredDescriptor(projectName));
}

function readDescriptorPath(appFolder: string): string {
  return appFolder === '.' ? compartmentDescriptorFileName : `${appFolder}/${compartmentDescriptorFileName}`;
}

function buildStarterDescriptorPreview(projectName: string): string {
  return `name: ${projectName}

services:
  web:
    accessMode: public
    kind: static
    path: .
    build:
      outputDirectory: apps/site
`;
}

function buildStarterIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Compartment Starter App</title>
  </head>
  <body>
    <p>Hello, this is your first Compartment app.</p>
  </body>
</html>
`;
}

function createDraftFile(path: string, content: string): GitDescriptorDraftFile {
  return {
    content,
    path,
  };
}

function isStarterEligibleRepository(tree: readonly GitRepositoryTreeEntry[]): boolean {
  const blobPaths: string[] = tree
    .filter((entry: GitRepositoryTreeEntry): boolean => entry.type === 'blob')
    .map((entry: GitRepositoryTreeEntry): string => entry.path);
  return blobPaths.every(isStarterAllowedPath);
}

function isStarterAllowedPath(path: string): boolean {
  const normalizedPath: string = path.toLowerCase();
  if (normalizedPath.startsWith('.github/')) {
    return true;
  }
  if (normalizedPath.includes('/')) {
    return false;
  }

  return (
    starterMetadataFileBaseNames.includes(normalizedPath) ||
    normalizedPath.startsWith('license') ||
    normalizedPath.startsWith('readme')
  );
}

function toPackageJsonDescriptorCandidate(packageJsonPath: string): PackageJsonDescriptorCandidate {
  return {
    appFolder: readAppFolder(packageJsonPath),
    packageJsonPath,
  };
}

function isSupportedPackageJsonPath(path: string): boolean {
  if (path === 'package.json') {
    return true;
  }
  const segments: string[] = path.split('/');
  return (
    segments.length === 3 &&
    segments[2] === 'package.json' &&
    (segments[0] === 'apps' || segments[0] === 'services') &&
    segments[1]!.length > 0
  );
}

function comparePackageJsonCandidatePaths(left: string, right: string): number {
  const rankComparison: number = readPackageJsonCandidateRank(left) - readPackageJsonCandidateRank(right);
  return rankComparison !== 0 ? rankComparison : left.localeCompare(right);
}

function readPackageJsonCandidateRank(path: string): number {
  if (path === 'package.json') {
    return 0;
  }
  if (path.startsWith('apps/')) {
    return 1;
  }
  if (path.startsWith('services/')) {
    return 2;
  }

  return 3;
}

function compareDescriptorPaths(left: string, right: string): number {
  const rankComparison: number =
    (left === compartmentDescriptorFileName ? 0 : 1) - (right === compartmentDescriptorFileName ? 0 : 1);
  return rankComparison !== 0 ? rankComparison : left.localeCompare(right);
}

function readAppFolder(packageJsonPath: string): string {
  return packageJsonPath === 'package.json' ? '.' : packageJsonPath.replace(/\/package\.json$/u, '');
}

function readProjectName(repositoryName: string, appFolder: string): string {
  const rawName: string = appFolder === '.' ? repositoryName : appFolder.split('/').at(-1)!;
  const normalizedName: string = slugifyText(rawName);
  const prefixedName: string = `app-${normalizedName}`.slice(0, 63);
  for (const candidate of [normalizedName, prefixedName, 'app']) {
    if (compartmentProjectNameSchema.safeParse(candidate).success) {
      return candidate;
    }
  }

  return 'app';
}
