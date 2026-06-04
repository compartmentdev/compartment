import { coerce, gte, type SemVer } from 'semver';

const minimumSelfHostedDockerEngineVersionText: string = '28.0.0';

export function assertSupportedSelfHostedDockerEngineVersion(rawVersion: string): void {
  const version: SemVer | null = coerce(rawVersion);
  if (version === null) {
    throw new Error(readUnknownDockerEngineVersionMessage(rawVersion));
  }

  if (!gte(version, minimumSelfHostedDockerEngineVersionText)) {
    throw new Error(readUnsupportedDockerEngineVersionMessage(version));
  }
}

function readUnsupportedDockerEngineVersionMessage(version: SemVer): string {
  return `${readMinimumDockerEngineVersionPrefix()} Found Docker Engine ${version.version}. Upgrade Docker Engine and re-run \`compartment install\` or \`compartment system update\`.`;
}

function readUnknownDockerEngineVersionMessage(rawVersion: string): string {
  const versionText: string = rawVersion.trim();
  const suffix: string = versionText === '' ? '' : ` Docker reported server version: ${JSON.stringify(versionText)}.`;
  return `${readMinimumDockerEngineVersionPrefix()} Unable to determine the Docker Engine server version.${suffix}`;
}

function readMinimumDockerEngineVersionPrefix(): string {
  return `Docker Engine ${minimumSelfHostedDockerEngineVersionText} or newer is required for self-hosted runtime management.`;
}
