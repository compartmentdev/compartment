import { describe, expect, it } from 'vitest';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';

describe('managed VM release metadata', (): void => {
  it('uses bounded digest-verified release artifacts without a latest URL', (): void => {
    expect(managedVmReleaseMetadata.artifacts).toHaveLength(4);
    for (const artifact of managedVmReleaseMetadata.artifacts) {
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifact.url).not.toMatch(/latest/u);
      expect(artifact.version).toMatch(/^v/u);
    }
    expect(managedVmReleaseMetadata.artifacts).toContainEqual({
      name: 'k3s-install-script',
      sha256: '46177d4c99440b4c0311b67233823a8e8a2fc09693f6c89af1a7161e152fbfad',
      url: 'https://raw.githubusercontent.com/k3s-io/k3s/v1.36.2%2Bk3s1/install.sh',
      version: 'v1.36.2+k3s1',
    });
    expect(managedVmReleaseMetadata.k3sChannel).not.toContain(managedVmReleaseMetadata.k3sVersion);
  });
});
