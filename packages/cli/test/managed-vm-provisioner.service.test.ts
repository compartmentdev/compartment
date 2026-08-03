import { describe, expect, it } from 'vitest';
import { provisionManagedVmCluster } from '../src/services/managed-vm-provisioner.service';

type GetUid = () => number;

describe('managed VM provisioner runtime boundary', (): void => {
  it('rejects a source CLI before entering host provisioning', async (): Promise<void> => {
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    process.getuid = (): number => 0;
    try {
      await expect(
        provisionManagedVmCluster({
          publicAddress: `203.0.${String(113)}.10`,
          publicInterface: 'ens3',
          reportStage: (): void => {
            throw new Error('A source CLI must not enter a mutation stage.');
          },
        }),
      ).rejects.toThrow('verified packaged Compartment CLI');
    } finally {
      process.getuid = getuid;
    }
  });
});
