import { describe, expect, it } from 'vitest';
import {
  formatManagedVmOwnedFileDrift,
  listManagedVmOwnedFileDrift,
} from '../src/services/managed-vm-owned-file-drift.service';
import type { ManagedVmOwnedPathDrift } from '../src/services/managed-vm-owned-file-drift.service.types';

const installerDigest: string = 'a'.repeat(64);
const replacedDigest: string = 'b'.repeat(64);

describe('managed VM owned file drift', (): void => {
  it('reports nothing when every recorded identity still matches the host', (): void => {
    const identities: Record<string, string> = { '/usr/local/bin/helm': `file:0755:${installerDigest}` };

    expect(listManagedVmOwnedFileDrift(identities, identities)).toEqual([]);
  });

  it('separates content, mode, and owner changes from missing and unexpected paths', (): void => {
    const drift: ManagedVmOwnedPathDrift[] = listManagedVmOwnedFileDrift(
      {
        '/etc/compartment': 'directory:1000:1000:0755',
        '/etc/containerd/runsc.toml': `file:0644:${installerDigest}`,
        '/usr/local/bin/compartment': `file:0755:${installerDigest}`,
        '/usr/local/bin/helm': `file:0755:${replacedDigest}`,
      },
      {
        '/etc/compartment': 'directory:0:0:0755',
        '/etc/containerd/runsc.toml': `file:0600:${installerDigest}`,
        '/etc/rancher/k3s/config.yaml': `file:0600:${installerDigest}`,
        '/usr/local/bin/helm': `file:0755:${installerDigest}`,
      },
    );

    expect(drift).toEqual([
      { detail: 'owner changed from 0:0 to 1000:1000', path: '/etc/compartment' },
      { detail: 'mode changed from 0600 to 0644', path: '/etc/containerd/runsc.toml' },
      { detail: 'missing from the host', path: '/etc/rancher/k3s/config.yaml' },
      { detail: 'present but never written by the installer', path: '/usr/local/bin/compartment' },
      { detail: 'content changed', path: '/usr/local/bin/helm' },
    ]);
    expect(formatManagedVmOwnedFileDrift(drift)).toContain('  /usr/local/bin/helm: content changed');
  });

  it('reports a path that changed between a file and a directory', (): void => {
    expect(
      listManagedVmOwnedFileDrift(
        { '/etc/compartment': `file:0644:${installerDigest}` },
        { '/etc/compartment': 'directory:0:0:0755' },
      ),
    ).toEqual([{ detail: 'type changed from directory to file', path: '/etc/compartment' }]);
  });

  it('treats an inherited property name as an absent path rather than reading Object.prototype', (): void => {
    expect(listManagedVmOwnedFileDrift({}, { constructor: `file:0755:${installerDigest}` })).toEqual([
      { detail: 'missing from the host', path: 'constructor' },
    ]);
  });
});
