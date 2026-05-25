import {
  readEffectiveIgnoreMatcher,
  readIgnoreBasePaths,
  readIgnoreMatcherPath,
  readSourceArchiveIgnoreRuleSet,
  type IgnoreMatchResult,
  type IgnoreMatcher,
  type IgnoreRuleSet,
} from './source-archive-ignore.helpers';

export interface SourceArchiveIgnoreState {
  archiveRootRelativeToIgnoreRoot: string;
  ignoreRoot: string;
  ignoreRulesByBasePath: Map<string, Promise<IgnoreRuleSet | null>>;
}

export async function isIgnoredSymlinkArchivePath(
  state: SourceArchiveIgnoreState,
  relativePath: string,
  selectedServiceRoot: string | undefined,
): Promise<boolean> {
  return await isArchivePathIgnored(state, relativePath, false, selectedServiceRoot);
}

export async function shouldSkipDirectoryEntry(
  directoryRelativePath: string,
  state: SourceArchiveIgnoreState,
  selectedServiceRoot: string | undefined,
): Promise<boolean> {
  return (
    directoryRelativePath !== '.' &&
    (await isArchivePathIgnored(state, directoryRelativePath, true, selectedServiceRoot))
  );
}

export async function isArchivePathIgnored(
  state: SourceArchiveIgnoreState,
  relativePath: string,
  isDirectory: boolean,
  selectedServiceRoot: string | undefined,
): Promise<boolean> {
  const ignoreRelativePath: string = readIgnoreRelativePath(state, relativePath);
  const selectedIgnoreRoot: string | undefined =
    selectedServiceRoot === undefined ? undefined : readIgnoreRelativePath(state, selectedServiceRoot);

  return await isIgnoreRelativePathIgnored(state, ignoreRelativePath, isDirectory, selectedIgnoreRoot);
}

async function isIgnoreRelativePathIgnored(
  state: SourceArchiveIgnoreState,
  ignoreRelativePath: string,
  isDirectory: boolean,
  selectedIgnoreRoot: string | undefined,
): Promise<boolean> {
  let ignored: boolean = false;

  for (const basePath of readIgnoreBasePaths(ignoreRelativePath)) {
    const matchResult: IgnoreMatchResult | null = await readIgnoreMatchResult(
      state,
      basePath,
      ignoreRelativePath,
      isDirectory,
      selectedIgnoreRoot,
    );
    if (matchResult === null) {
      continue;
    }
    if (matchResult.ignored || matchResult.unignored) {
      ignored = matchResult.ignored;
    }
  }

  return ignored;
}

async function readIgnoreMatchResult(
  state: SourceArchiveIgnoreState,
  basePath: string,
  relativePath: string,
  isDirectory: boolean,
  selectedServiceRoot: string | undefined,
): Promise<IgnoreMatchResult | null> {
  const ignoreRuleSet: IgnoreRuleSet | null = await readCachedIgnoreRuleSet(state, basePath);
  if (ignoreRuleSet === null) {
    return null;
  }

  const matcherPath: string | null = readIgnoreMatcherPath(basePath, relativePath);
  if (matcherPath === null) {
    return null;
  }

  const matcher: IgnoreMatcher = readEffectiveIgnoreMatcher(ignoreRuleSet, selectedServiceRoot);
  return matcher.test(isDirectory ? `${matcherPath}/` : matcherPath);
}

async function readCachedIgnoreRuleSet(
  state: SourceArchiveIgnoreState,
  basePath: string,
): Promise<IgnoreRuleSet | null> {
  const existingRuleSetPromise: Promise<IgnoreRuleSet | null> | undefined = state.ignoreRulesByBasePath.get(basePath);
  if (existingRuleSetPromise !== undefined) {
    return await existingRuleSetPromise;
  }

  const ignoreRuleSetPromise: Promise<IgnoreRuleSet | null> = readSourceArchiveIgnoreRuleSet(
    state.ignoreRoot,
    basePath,
  );
  state.ignoreRulesByBasePath.set(basePath, ignoreRuleSetPromise);
  return await ignoreRuleSetPromise;
}

function readIgnoreRelativePath(state: SourceArchiveIgnoreState, relativePath: string): string {
  if (state.archiveRootRelativeToIgnoreRoot === '.') {
    return relativePath;
  }

  return relativePath === '.'
    ? state.archiveRootRelativeToIgnoreRoot
    : `${state.archiveRootRelativeToIgnoreRoot}/${relativePath}`;
}
