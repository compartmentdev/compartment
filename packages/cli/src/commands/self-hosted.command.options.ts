import { readCliBuildInfo } from '../cli-build-info';
import type { CliBuildInfo, CliDistributionChannel } from '../cli-build-info.types';
import type { InstallImageSource } from '../install.types';
import { defaultSelfHostedRuntimeImageRegistry } from '../self-hosted-env';
import type { SelfHostedRuntimeImageRegistry } from '../self-hosted-env.types';

const mainBuildVersionPattern: RegExp = /^sha-[0-9a-f]{7,40}$/iu;

export interface SelfHostedVersionSelection {
  sourceChannel?: CliDistributionChannel | undefined;
  usesCliDefault: boolean;
  value: string;
}

export function readSelfHostedImageSource(value: string | undefined): InstallImageSource {
  if (value === undefined) {
    return 'registry';
  }

  if (value === 'registry') {
    return 'registry';
  }
  if (value === 'local') {
    return 'local';
  }

  throw new Error('Install image source must be `registry` or `local` when provided.');
}

export function readOptionalSelfHostedImageRegistry(
  value: string | undefined,
): SelfHostedRuntimeImageRegistry | undefined {
  return value === undefined ? undefined : readSelfHostedImageRegistry(value);
}

export function readSelfHostedImageRegistry(value: string | undefined): SelfHostedRuntimeImageRegistry {
  if (value === undefined) {
    return defaultSelfHostedRuntimeImageRegistry;
  }

  if (value === 'github') {
    return 'github';
  }
  if (value === 'docker-hub') {
    return 'docker-hub';
  }

  throw new Error('Self-hosted image registry must be `github` or `docker-hub` when provided.');
}

export function resolveSelfHostedVersionSelection(value: string | undefined): SelfHostedVersionSelection {
  if (value === undefined) {
    const cliBuildInfo: CliBuildInfo = readCliBuildInfo();
    return {
      sourceChannel: cliBuildInfo.distributionChannel,
      usesCliDefault: true,
      value: cliBuildInfo.defaultRegistryImageTag,
    };
  }

  if (value === 'latest' || value === 'main' || mainBuildVersionPattern.test(value) || /^\d+\.\d+\.\d+$/.test(value)) {
    return {
      usesCliDefault: false,
      value,
    };
  }

  throw new Error('Install version must be `latest`, `main`, `sha-<commit>`, or an exact release like `0.2.0`.');
}

export function assertSelfHostedVersionMatchesPackagedNodeAgent(selection: SelfHostedVersionSelection): void {
  if (selection.usesCliDefault) {
    return;
  }

  const cliBuildInfo: CliBuildInfo = readCliBuildInfo();
  if (selection.value === cliBuildInfo.defaultRegistryImageTag) {
    return;
  }

  throw new Error(
    'Host node-agent must come from the same packaged compartment CLI as the selected runtime version. Install the matching CLI first or omit --version.',
  );
}
