import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as BuildArtifactSbomQueryModule from '../src/queries/build-artifact-sbom.query';
import type { StoreBuildArtifactSbomInput } from '../src/queries/build-artifact-sbom.query.types';
import { persistBuildArtifactSbom } from '../src/services/build-artifact-sbom.service';

type StoreBuildArtifactSbom = (input: StoreBuildArtifactSbomInput) => Promise<boolean>;
const storeBuildArtifactSbom: Mock<StoreBuildArtifactSbom> = vi.hoisted(
  (): Mock<StoreBuildArtifactSbom> => vi.fn<StoreBuildArtifactSbom>(),
);

vi.mock(
  '../src/queries/build-artifact-sbom.query',
  async (
    importOriginal: () => Promise<typeof BuildArtifactSbomQueryModule>,
  ): Promise<typeof BuildArtifactSbomQueryModule> => {
    const actual: typeof BuildArtifactSbomQueryModule = await importOriginal();
    return { ...actual, storeBuildArtifactSbom };
  },
);

beforeEach((): void => {
  storeBuildArtifactSbom.mockReset();
});

describe('persistBuildArtifactSbom', (): void => {
  it('rejects invalid JSON before persistence', async (): Promise<void> => {
    await expect(
      persistBuildArtifactSbom({
        artifactId: 'art_123',
        deploymentId: 'dep_123',
        digest: `sha256:${'a'.repeat(64)}`,
        imageDigest: `sha256:${'b'.repeat(64)}`,
        sbomJson: '{',
      }),
    ).rejects.toThrow('valid Syft JSON');
    expect(storeBuildArtifactSbom).not.toHaveBeenCalled();
  });

  it('rejects an SBOM digest that does not match its JSON', async (): Promise<void> => {
    const sbomJson: string = JSON.stringify({ artifacts: [] });
    await expect(
      persistBuildArtifactSbom({
        artifactId: 'art_123',
        deploymentId: 'dep_123',
        digest: `sha256:${'a'.repeat(64)}`,
        imageDigest: `sha256:${'b'.repeat(64)}`,
        sbomJson,
      }),
    ).rejects.toThrow('digest does not match');
    expect(storeBuildArtifactSbom).not.toHaveBeenCalled();
  });

  it('rejects an image digest masquerading as SBOM evidence', async (): Promise<void> => {
    await expect(
      persistBuildArtifactSbom({
        artifactId: 'art_123',
        deploymentId: 'dep_123',
        digest: `sha256:${'a'.repeat(64)}`,
        imageDigest: `sha256:${'b'.repeat(64)}`,
        sbomJson: '{}',
      }),
    ).rejects.toThrow('Syft artifact inventory');
    expect(storeBuildArtifactSbom).not.toHaveBeenCalled();
  });
});
