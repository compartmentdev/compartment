import type { UpdateSkipReason } from '@compartment/contracts';
import type {
  DecideSelfHostedUpdateActionInput,
  SelfHostedUpdateDecision,
  ParsedSelfHostedReleaseVersion,
} from './update-version.types';

const releaseVersionPattern: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;

export function decideSelfHostedUpdateAction(input: DecideSelfHostedUpdateActionInput): SelfHostedUpdateDecision {
  if (input.currentVersion === input.targetVersion) {
    return input.currentImageSource !== input.targetImageSource
      ? createApplySelfHostedUpdateDecision()
      : createSkipSelfHostedUpdateDecision('already-current');
  }

  const currentVersion: ParsedSelfHostedReleaseVersion | undefined = readParsedSelfHostedReleaseVersion(
    input.currentVersion,
  );
  const targetVersion: ParsedSelfHostedReleaseVersion | undefined = readParsedSelfHostedReleaseVersion(
    input.targetVersion,
  );
  if (currentVersion === undefined || targetVersion === undefined) {
    return createApplySelfHostedUpdateDecision();
  }

  return readParsedSelfHostedUpdateDecision(input, currentVersion, targetVersion);
}

function readParsedSelfHostedUpdateDecision(
  input: DecideSelfHostedUpdateActionInput,
  currentVersion: ParsedSelfHostedReleaseVersion,
  targetVersion: ParsedSelfHostedReleaseVersion,
): SelfHostedUpdateDecision {
  const comparison: number = compareParsedSelfHostedReleaseVersions(targetVersion, currentVersion);
  if (comparison > 0) {
    return createApplySelfHostedUpdateDecision();
  }
  if (comparison === 0) {
    return input.currentImageSource !== input.targetImageSource
      ? createApplySelfHostedUpdateDecision()
      : createSkipSelfHostedUpdateDecision('already-current');
  }

  return createSkipSelfHostedUpdateDecision('downgrade-not-supported');
}

function createApplySelfHostedUpdateDecision(): SelfHostedUpdateDecision {
  return {
    action: 'apply',
  };
}

function createSkipSelfHostedUpdateDecision(reason: UpdateSkipReason): SelfHostedUpdateDecision {
  return {
    action: 'skip',
    reason,
  };
}

function readParsedSelfHostedReleaseVersion(value: string): ParsedSelfHostedReleaseVersion | undefined {
  const match: RegExpExecArray | null = releaseVersionPattern.exec(value);
  if (match === null) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareParsedSelfHostedReleaseVersions(
  left: ParsedSelfHostedReleaseVersion,
  right: ParsedSelfHostedReleaseVersion,
): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}
