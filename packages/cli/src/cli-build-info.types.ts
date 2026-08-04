import type { JsonValue } from '@compartment/utils';

export type CliDistributionChannel = 'source' | 'main' | 'release';

export interface CliBuildInfo {
  buildCommitSha?: string | undefined;
  cliVersion: string;
  distributionChannel: CliDistributionChannel;
}

export interface CliBuildInfoCandidate {
  buildCommitSha?: JsonValue | undefined;
  cliVersion?: JsonValue | undefined;
  distributionChannel?: JsonValue | undefined;
}

export interface CliPackageJson {
  version?: string | undefined;
}
