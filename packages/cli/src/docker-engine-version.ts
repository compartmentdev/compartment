import { coerce, gte, parse, type SemVer } from 'semver';

const minimumSelfHostedDockerEngineVersionText: string = '28.0.0';
const dockerEngineVersionTextPattern: RegExp = /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/u;

export function assertSupportedSelfHostedDockerEngineVersion(rawVersion: string): void {
  const versionText: string = rawVersion.trim();
  if (!dockerEngineVersionTextPattern.test(versionText)) {
    throw new Error(readUnknownDockerEngineVersionMessage(rawVersion));
  }

  const version: SemVer | null = parse(versionText, { loose: true }) ?? coerce(versionText);
  if (version === null) {
    throw new Error(readUnknownDockerEngineVersionMessage(rawVersion));
  }

  if (!gte(version, minimumSelfHostedDockerEngineVersionText)) {
    throw new Error(readUnsupportedDockerEngineVersionMessage(version));
  }
}

function readUnsupportedDockerEngineVersionMessage(version: SemVer): string {
  return `${readMinimumDockerEngineVersionPrefix()} Found version ${version.version}. Upgrade it and re-run \`compartment install\` or \`compartment system update\`.`;
}

function readUnknownDockerEngineVersionMessage(rawVersion: string): string {
  const versionText: string = rawVersion.trim();
  const suffix: string = versionText === '' ? '' : ` Docker reported server version: ${JSON.stringify(versionText)}.`;
  return `${readMinimumDockerEngineVersionPrefix()} Unable to determine the Docker Engine server version.${suffix}`;
}

function readMinimumDockerEngineVersionPrefix(): string {
  return `Docker Engine ${minimumSelfHostedDockerEngineVersionText} or newer is required for self-hosted runtime management.`;
}
