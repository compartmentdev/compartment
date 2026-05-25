import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readCliVersion } from '../src/cli-build-info';

type ReadSeaAssetText = (assetName: string) => string | undefined;

interface CliBuildInfoTestMocks {
  readSeaAssetText: Mock<ReadSeaAssetText>;
}

const mocks: CliBuildInfoTestMocks = vi.hoisted(
  (): CliBuildInfoTestMocks => ({
    readSeaAssetText: vi.fn<ReadSeaAssetText>(),
  }),
);

vi.mock('../src/sea', (): { readSeaAssetText: Mock<ReadSeaAssetText> } => ({
  readSeaAssetText: mocks.readSeaAssetText,
}));

interface CliPackageJson {
  version: string;
}

describe('readCliVersion', (): void => {
  afterEach((): void => {
    mocks.readSeaAssetText.mockReset();
  });

  it('returns the package version when no SEA build info is embedded', (): void => {
    expect(readCliVersion()).toBe(readCliPackageVersion());
  });

  it('formats main builds with the embedded short commit sha', (): void => {
    mocks.readSeaAssetText.mockReturnValue(
      JSON.stringify({
        buildCommitSha: '1234567890abcdef1234567890abcdef12345678',
        cliVersion: readCliPackageVersion(),
        defaultRegistryImageTag: 'sha-1234567890abcdef1234567890abcdef12345678',
        distributionChannel: 'main',
      }),
    );

    expect(readCliVersion()).toBe(`${readCliPackageVersion()}-main+1234567`);
  });

  it('keeps stable release output on the plain CLI version', (): void => {
    mocks.readSeaAssetText.mockReturnValue(
      JSON.stringify({
        buildCommitSha: '1234567890abcdef1234567890abcdef12345678',
        cliVersion: readCliPackageVersion(),
        defaultRegistryImageTag: readCliPackageVersion(),
        distributionChannel: 'release',
      }),
    );

    expect(readCliVersion()).toBe(readCliPackageVersion());
  });
});

function readCliPackageVersion(): string {
  const packageJsonPath: string = resolve(__dirname, '../package.json');
  const packageJson: CliPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as CliPackageJson;
  return packageJson.version;
}
