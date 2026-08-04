import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as FileSystemPromises from 'node:fs/promises';
import type { PathLike } from 'node:fs';
import type { ManagedVmCommandResult } from '../src/services/managed-vm-command.service.types';

interface HostRuntimeMocks {
  execa: Mock;
}

const mocks: HostRuntimeMocks = vi.hoisted(
  (): HostRuntimeMocks => ({
    execa: vi.fn(),
  }),
);

vi.mock('../src/services/managed-vm-command.service', (): object => ({ execa: mocks.execa }));
vi.mock('../src/services/managed-vm-network.service', (): object => ({
  readReachableManagedVmEndpoints: vi.fn().mockResolvedValue([]),
}));
vi.mock('node:fs/promises', async (importOriginal: () => Promise<typeof FileSystemPromises>): Promise<object> => {
  const original: typeof FileSystemPromises = await importOriginal();
  return {
    ...original,
    readFile: vi.fn(async (path: PathLike | FileSystemPromises.FileHandle): Promise<string> => {
      if (path === '/etc/os-release') {
        return 'ID=ubuntu\nVERSION_ID="24.04"\n';
      }
      return await original.readFile(path, 'utf8');
    }),
  };
});

describe('managed VM host runtime', (): void => {
  beforeEach((): void => {
    mocks.execa.mockImplementation(
      async (command: string, args: readonly string[]): Promise<ManagedVmCommandResult> => {
        const stdout: string = await Promise.resolve(commandOutput(command, args));
        return { exitCode: 0, stderr: '', stdout };
      },
    );
  });

  it('reads disk values when df ends with a trailing newline', async (): Promise<void> => {
    const { inspectManagedVmHost } = await import('../src/services/managed-vm-host-runtime.service');

    await expect(inspectManagedVmHost()).resolves.toMatchObject({
      freeBytes: 306_975_531_008,
      freeInodes: 19_664_281,
    });
  });

  it('reports zero instead of NaN when df has no numeric data row', async (): Promise<void> => {
    mocks.execa.mockImplementation(
      async (command: string, args: readonly string[]): Promise<ManagedVmCommandResult> => {
        const stdout: string = await Promise.resolve(command === 'df' ? 'Avail\n' : commandOutput(command, args));
        return { exitCode: 0, stderr: '', stdout };
      },
    );
    const { inspectManagedVmHost } = await import('../src/services/managed-vm-host-runtime.service');

    await expect(inspectManagedVmHost()).resolves.toMatchObject({ freeBytes: 0, freeInodes: 0 });
  });
});

function commandOutput(command: string, args: readonly string[]): string {
  if (command === 'df' && args.includes('--output=avail')) {
    return '       Avail\n306975531008\n';
  }
  if (command === 'df' && args.includes('--output=iavail')) {
    return '  IAvail\n19664281\n';
  }
  if (command === 'timedatectl') {
    return 'yes\n';
  }
  if (command === 'lsmod') {
    return 'overlay\nbr_netfilter\nnf_tables\n';
  }
  if (command === 'ip' && args.includes('address')) {
    return '2: eth0    inet 46.225.172.160/32 scope global eth0\n';
  }
  if (command === 'ip' && args.includes('default')) {
    return 'default via 172.31.1.1 dev eth0\n';
  }
  return '';
}
