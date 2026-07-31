import { hasText } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type { LocalGitSourcePlan } from './source-git-local.service.types';

interface ReadGitOutputOptions {
  allowEmptyOutput?: boolean | undefined;
}

interface ParsedGitRemote {
  providerHost: string;
  repositoryName: string;
  repositoryOwner: string;
}

export async function readLocalGitSourcePlan(cwd: string): Promise<LocalGitSourcePlan> {
  const remoteName: string = await readPreferredRemoteName(cwd);
  const remote: ParsedGitRemote = parseGitRemoteUrl(
    await readGitOutput(cwd, ['config', '--get', `remote.${remoteName}.url`], 'Failed to read Git remote URL.'),
  );

  return {
    providerHost: remote.providerHost,
    repositoryName: remote.repositoryName,
    repositoryOwner: remote.repositoryOwner,
  };
}

async function readPreferredRemoteName(cwd: string): Promise<string> {
  const remotes: string[] = (await readGitOutput(cwd, ['remote'], 'Failed to list Git remotes.'))
    .split('\n')
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => hasText(line));
  if (remotes.includes('origin')) {
    return 'origin';
  }
  if (remotes.length === 1) {
    return remotes[0]!;
  }

  throw new Error('Expected a single Git remote or an origin remote.');
}

async function readGitOutput(
  cwd: string,
  args: readonly string[],
  errorMessage: string,
  options: ReadGitOutputOptions = {},
): Promise<string> {
  const result: CommandResult = await runCommand(['git', '-C', cwd, ...args], process.env);
  if (result.exitCode !== 0) {
    throw new Error(readGitCommandError(errorMessage, result.stderr));
  }

  const output: string = result.stdout.trim();
  if (options.allowEmptyOutput !== true && !hasText(output)) {
    throw new Error(errorMessage);
  }

  return output;
}

function readGitCommandError(message: string, stderr: string): string {
  return hasText(stderr) ? `${message} ${stderr.trim()}` : message;
}

function parseGitRemoteUrl(value: string): ParsedGitRemote {
  return parseSshRemoteUrl(value) ?? parseStandardRemoteUrl(value) ?? failUnsupportedRemote();
}

function parseSshRemoteUrl(value: string): ParsedGitRemote | null {
  const match: RegExpMatchArray | null = /^git@([^:]+):(.+)$/.exec(value);
  if (match === null) {
    return null;
  }

  return buildParsedGitRemote(match[1]!, match[2]!);
}

function parseStandardRemoteUrl(value: string): ParsedGitRemote | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') return null;
  const providerHost: string = parsed.protocol === 'ssh:' ? parsed.hostname : parsed.host;
  return buildParsedGitRemote(providerHost, parsed.pathname);
}

function buildParsedGitRemote(providerHost: string, path: string): ParsedGitRemote | null {
  const pathSegments: string[] | null = decodePathSegments(path);
  if (pathSegments === null) return null;
  if (pathSegments.length < 2) return null;
  const repositoryName: string = pathSegments.pop()!.replace(/\.git$/i, '');
  if (!hasText(repositoryName)) return null;
  return {
    providerHost: providerHost.toLowerCase(),
    repositoryName,
    repositoryOwner: pathSegments.join('/'),
  };
}

function decodePathSegments(path: string): string[] | null {
  try {
    return path.split('/').filter(hasText).map(decodeURIComponent);
  } catch {
    return null;
  }
}

function failUnsupportedRemote(): never {
  throw new Error('Unsupported Git remote URL. Use an HTTPS or SSH repository remote.');
}
