import { describe, expect, it } from 'vitest';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';

describe('managed VM release metadata', (): void => {
  it('uses bounded digest-verified release artifacts without a latest URL', (): void => {
    expect(managedVmReleaseMetadata.artifacts).toHaveLength(5);
    for (const artifact of managedVmReleaseMetadata.artifacts) {
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifact.url).not.toMatch(/latest/u);
      expect(artifact.version).toMatch(/^(?:v|release-)/u);
    }
    expect(managedVmReleaseMetadata.artifacts).toContainEqual({
      name: 'k3s-install-script',
      sha256: '8598e002e61d658fed7b7542fc6d2c66d8da6eae69e088830105d2ee1ffb6d91',
      url: 'https://raw.githubusercontent.com/k3s-io/k3s/v1.35.5%2Bk3s1/install.sh',
      version: 'v1.35.5+k3s1',
    });
    expect(managedVmReleaseMetadata.artifacts).toContainEqual({
      name: 'helm',
      sha256: '70b2c30a19da4db264dfd68c8a3664e05093a361cefd89572ffb36f8abfa3d09',
      url: 'https://get.helm.sh/helm-v4.1.4-linux-amd64.tar.gz',
      version: 'v4.1.4',
    });
    expect(managedVmReleaseMetadata.artifacts).toContainEqual({
      name: 'gvisor',
      sha256: '386bdc2196fc600b68ff8dafdd8ecdc6a8e033ecf9cfa9dfab61ec1b389da307',
      sha512:
        '2a440a27a1297ee2124b5c4915b44f9cbcd82ed7871a7ddd99f6602e6d550f8d080f26cb1fa8259d1bd6cde1f4e5942d3eff11116c450b28b2ddfdd92654e87a',
      url: 'https://storage.googleapis.com/gvisor/releases/pool/20260727.0/binary-amd64/runsc.deb',
      version: 'release-20260727.0',
    });
    expect(managedVmReleaseMetadata.metadataVersion).toBe(4);
    expect(managedVmReleaseMetadata.helmVersion).toBe('v4.1.4');
    expect(managedVmReleaseMetadata.k3sChannel).not.toContain(managedVmReleaseMetadata.k3sVersion);
  });
});
