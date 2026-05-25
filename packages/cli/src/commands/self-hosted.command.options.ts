import { readCliBuildInfo } from '../cli-build-info';
import type { CliBuildInfo, CliDistributionChannel } from '../cli-build-info.types';
import type { InstallImageSource } from '../install.types';

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
