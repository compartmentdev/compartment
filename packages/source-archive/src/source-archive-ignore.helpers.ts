import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import createIgnore from 'ignore';
import { isMissingFileSystemEntryError, readNonEmptyLines } from '@compartment/utils';

const gitIgnoreFilename: string = '.gitignore';

export interface IgnoreMatchResult {
  ignored: boolean;
  unignored: boolean;
}

export interface IgnoreMatcher {
  test(pathname: string): IgnoreMatchResult;
}

export interface IgnoreRuleSet {
  basePath: string;
  matcher: IgnoreMatcher;
  matcherBySelectedRoot: Map<string, IgnoreMatcher>;
  rules: string[];
}

export function readIgnoreBasePaths(relativePath: string): string[] {
  const basePaths: string[] = ['.'];
  const parentPath: string = readParentRelativePath(relativePath);
  if (parentPath === '.') {
    return basePaths;
  }

  let currentPath: string = '';
  for (const segment of parentPath.split('/')) {
    currentPath = currentPath === '' ? segment : `${currentPath}/${segment}`;
    basePaths.push(currentPath);
  }

  return basePaths;
}

export function readEffectiveIgnoreMatcher(
  ignoreRuleSet: IgnoreRuleSet,
  selectedServiceRoot: string | undefined,
): IgnoreMatcher {
  if (selectedServiceRoot === undefined) {
    return ignoreRuleSet.matcher;
  }

  const matcherPath: string | null = readIgnoreMatcherPath(ignoreRuleSet.basePath, selectedServiceRoot);
  if (matcherPath === null || matcherPath === '.') {
    return ignoreRuleSet.matcher;
  }

  const cachedMatcher: IgnoreMatcher | undefined = ignoreRuleSet.matcherBySelectedRoot.get(matcherPath);
  if (cachedMatcher !== undefined) {
    return cachedMatcher;
  }

  const matcher: IgnoreMatcher = createSelectedRootMatcher(ignoreRuleSet.rules, matcherPath);
  ignoreRuleSet.matcherBySelectedRoot.set(matcherPath, matcher);
  return matcher;
}

export function readIgnoreMatcherPath(basePath: string, relativePath: string): string | null {
  if (basePath === '.') {
    return relativePath;
  }
  if (relativePath === basePath) {
    return null;
  }
  if (!relativePath.startsWith(`${basePath}/`)) {
    return null;
  }

  return relativePath.slice(basePath.length + 1);
}

export async function readSourceArchiveIgnoreRuleSet(
  ignoreRoot: string,
  basePath: string,
): Promise<IgnoreRuleSet | null> {
  try {
    const fileContents: string = await readFile(join(ignoreRoot, basePath, gitIgnoreFilename), 'utf8');
    const rules: string[] = readNonEmptyLines(fileContents);
    return {
      basePath,
      matcher: createIgnore().add(rules),
      matcherBySelectedRoot: new Map<string, IgnoreMatcher>(),
      rules,
    };
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return null;
    }

    throw error;
  }
}

function createSelectedRootMatcher(rules: readonly string[], matcherPath: string): IgnoreMatcher {
  return createIgnore().add(
    rules.filter((rule: string): boolean => !isIgnoredSelectedRoot(createIgnore().add(rule), matcherPath)),
  );
}

function isIgnoredSelectedRoot(matcher: IgnoreMatcher, matcherPath: string): boolean {
  const fileMatchResult: IgnoreMatchResult = matcher.test(matcherPath);
  if (fileMatchResult.ignored && !fileMatchResult.unignored) {
    return true;
  }

  const directoryMatchResult: IgnoreMatchResult = matcher.test(`${matcherPath}/`);
  return directoryMatchResult.ignored && !directoryMatchResult.unignored;
}

function readParentRelativePath(relativePath: string): string {
  if (relativePath === '.' || !relativePath.includes('/')) {
    return '.';
  }

  return relativePath.slice(0, relativePath.lastIndexOf('/'));
}
