import { readCliBuildInfo } from '../cli-build-info';
import type { CliBuildInfo } from '../cli-build-info.types';
import type {
  KubernetesPlatformImageVersionValue,
  KubernetesPlatformImageVersionValues,
} from './kubernetes-platform-version.service.types';

const imageTagPattern: RegExp = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;

export function resolvePackagedKubernetesPlatformVersion(): string | undefined {
  const buildInfo: CliBuildInfo = readCliBuildInfo();
  if (buildInfo.distributionChannel === 'main' && buildInfo.buildCommitSha !== undefined) {
    return `sha-${buildInfo.buildCommitSha}`;
  }
  if (buildInfo.distributionChannel === 'release') {
    return readKubernetesPlatformImageTag(buildInfo.cliVersion);
  }
  return undefined;
}

export function readKubernetesPlatformImageTag(value: string): string {
  const normalized: string = value.trim();
  if (!imageTagPattern.test(normalized)) {
    throw new Error('Platform version must be a valid image tag.');
  }
  return normalized;
}

export function buildKubernetesPlatformImageVersionValues(version: string): KubernetesPlatformImageVersionValues {
  const image: KubernetesPlatformImageVersionValue = { digest: '', tag: version };
  return { images: { api: image, buildkitSeed: image, caddy: image, dns01Solver: image, edge: image, worker: image } };
}
