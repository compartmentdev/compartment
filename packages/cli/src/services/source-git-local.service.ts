import { hasText } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type { LocalGitSourcePlan } from './source-git-local.service.types';

interface ReadGitOutputOptions {
  allowEmptyOutput?: boolean | undefined;
}

interface ParsedGitHubRemote {
  providerHost: string;
  repositoryName: string;
  repositoryOwner: string;
}

export async function readLocalGitSourcePlan(cwd: string): Promise<LocalGitSourcePlan> {
  const remoteName: string = await readPreferredRemoteName(cwd);
  const remote: ParsedGitHubRemote = parseGitHubRemoteUrl(
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

function parseGitHubRemoteUrl(value: string): ParsedGitHubRemote {
  return parseSshRemoteUrl(value) ?? parseStandardRemoteUrl(value) ?? failUnsupportedRemote(value);
}

function parseSshRemoteUrl(value: string): ParsedGitHubRemote | null {
  const match: RegExpMatchArray | null = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(value);
  if (match === null) {
    return null;
  }

  return {
    providerHost: match[1]!.toLowerCase(),
    repositoryName: match[3]!,
    repositoryOwner: match[2]!,
  };
}

function parseStandardRemoteUrl(value: string): ParsedGitHubRemote | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const pathSegments: string[] = parsed.pathname.split('/').filter(hasText);
  if (pathSegments.length !== 2) {
    return null;
  }

  return {
    providerHost: parsed.host.toLowerCase(),
    repositoryName: pathSegments[1]?.replace(/\.git$/, '') ?? '',
    repositoryOwner: pathSegments[0] ?? '',
  };
}

function failUnsupportedRemote(value: string): never {
  throw new Error(`Unsupported Git remote URL for GitHub App bootstrap: ${value}`);
}
