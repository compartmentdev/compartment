import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasText, type JsonValue } from '@compartment/utils';
import { readSeaAssetText } from './sea';
import type {
  CliBuildInfo,
  CliBuildInfoCandidate,
  CliDistributionChannel,
  CliPackageJson,
} from './cli-build-info.types';

const cliBuildInfoAssetName: string = 'cli-build-info.json';
const commitShaPattern: RegExp = /^[0-9a-f]{7,40}$/i;
const defaultDistributionChannel: CliDistributionChannel = 'source';
const defaultRegistryImageTag: string = 'latest';
const mainVersionCommitLength: number = 7;
const packageJsonPath: string = resolve(__dirname, '../package.json');

export function readCliVersion(): string {
  return formatCliVersion(readCliBuildInfo());
}

function readCliBuildInfo(): CliBuildInfo {
  const seaBuildInfoText: string | undefined = readSeaAssetText(cliBuildInfoAssetName);
  if (seaBuildInfoText !== undefined) {
    return parseCliBuildInfo(seaBuildInfoText);
  }

  return {
    cliVersion: readPackageVersion(),
    defaultRegistryImageTag,
    distributionChannel: defaultDistributionChannel,
  };
}

function formatCliVersion(buildInfo: CliBuildInfo): string {
  if (buildInfo.distributionChannel !== 'main') {
    return buildInfo.cliVersion;
  }

  if (!hasText(buildInfo.buildCommitSha)) {
    return buildInfo.cliVersion;
  }

  return `${buildInfo.cliVersion}-main+${buildInfo.buildCommitSha.slice(0, mainVersionCommitLength)}`;
}

function parseCliBuildInfo(value: string): CliBuildInfo {
  const parsedValue: JsonValue = JSON.parse(value) as JsonValue;
  if (isCliBuildInfo(parsedValue)) {
    return parsedValue;
  }

  throw new Error(`Invalid embedded CLI build info in ${cliBuildInfoAssetName}.`);
}

function readPackageVersion(): string {
  const packageJson: CliPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as CliPackageJson;
  if (hasText(packageJson.version)) {
    return packageJson.version;
  }

  throw new Error(`Expected ${packageJsonPath} to define a non-empty version.`);
}

function isCliBuildInfo(value: CliBuildInfo | JsonValue): value is CliBuildInfo {
  if (!isCliBuildInfoCandidate(value)) {
    return false;
  }

  return (
    isOptionalBuildCommitSha(value.buildCommitSha) &&
    hasText(readStringCandidate(value.cliVersion)) &&
    hasText(readStringCandidate(value.defaultRegistryImageTag)) &&
    isCliDistributionChannel(value.distributionChannel)
  );
}

function isCliBuildInfoCandidate(value: CliBuildInfoCandidate | JsonValue): value is CliBuildInfoCandidate {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCliDistributionChannel(value: JsonValue | undefined): value is CliDistributionChannel {
  return value === 'source' || value === 'main' || value === 'release';
}

function isOptionalBuildCommitSha(value: string | JsonValue | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  const buildCommitSha: string | undefined = readStringCandidate(value);
  return buildCommitSha !== undefined && commitShaPattern.test(buildCommitSha);
}

function readStringCandidate(value: string | JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
