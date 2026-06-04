import { readRequiredOptionValue } from './options.mjs';

export function readGitHubReleaseCliOptions(args, { commandName, readOption, requiredUsage }) {
  let releaseRepository;
  let releaseTag;
  const positionalArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--repo') {
      releaseRepository = readRequiredOptionValue(args, ++index, '--repo');
      continue;
    }

    if (argument === '--tag') {
      releaseTag = readRequiredOptionValue(args, ++index, '--tag');
      continue;
    }

    const nextIndex = readOption?.({ argument, args, index, readRequiredOptionValue });
    if (nextIndex !== undefined) {
      index = nextIndex;
      continue;
    }

    if (argument.startsWith('--')) {
      throw new Error(`Unknown ${commandName} argument: ${argument}`);
    }

    positionalArgs.push(argument);
  }

  if (releaseRepository === undefined || releaseTag === undefined) {
    throw new Error(requiredUsage);
  }

  return {
    positionalArgs,
    releaseRepository,
    releaseTag,
  };
}
