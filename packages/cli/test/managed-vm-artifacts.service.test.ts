import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  downloadManagedVmArtifacts,
  type ManagedVmDownloadedArtifacts,
} from '../src/services/managed-vm-artifacts.service';
import type { ManagedVmCommandResult } from '../src/services/managed-vm-command.service';
import type { ManagedVmArtifact } from '../src/services/managed-vm-provisioning.types';

interface ArtifactTestMocks {
  execa: Mock;
}

const mocks: ArtifactTestMocks = vi.hoisted((): ArtifactTestMocks => ({ execa: vi.fn() }));

vi.mock('../src/services/managed-vm-command.service', (): ArtifactTestMocks => ({ execa: mocks.execa }));

beforeEach((): void => {
  mocks.execa.mockReset();
  mocks.execa.mockImplementation(runArtifactTool);
});

async function runArtifactTool(
  command: string,
  args: readonly string[],
  extractGvisor: boolean = true,
): Promise<ManagedVmCommandResult> {
  if (command === 'tar') {
    const directory: string = args[args.indexOf('-C') + 1]!;
    const helmDirectory: string = join(directory, 'linux-amd64');
    await mkdir(helmDirectory, { recursive: true });
    await writeFile(join(helmDirectory, 'helm'), 'verified helm');
  }
  if (command === '/usr/bin/dpkg-deb' && extractGvisor) {
    const directory: string = args[2]!;
    const files: readonly string[] = [
      'usr/bin/gvisor-bin/checkpointgofer',
      'usr/bin/gvisor-bin/runsc-metric-server',
      'usr/bin/containerd-shim-runsc-v1',
      'usr/bin/runsc',
      'etc/containerd/runsc.toml',
    ];
    await Promise.all(
      files.map(async (file: string): Promise<void> => {
        const path: string = join(directory, file);
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, `verified ${file}`);
      }),
    );
  }
  return { exitCode: 0, stderr: '', stdout: '' };
}

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('managed VM artifacts', (): void => {
  it('rejects unverified bytes before an artifact can be installed', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response('unexpected bytes')),
    );
    const artifact: ManagedVmArtifact = {
      name: 'k3s',
      sha256: '0'.repeat(64),
      url: 'https://releases.example.test/k3s',
      version: 'v1.35.5+k3s1',
    };
    await expect(downloadManagedVmArtifacts([artifact])).rejects.toThrow('k3s digest verification failed');
  });

  it('requires an independently verified gVisor SHA-512 digest', async (): Promise<void> => {
    const bytes: Buffer = Buffer.from('verified by sha256 only');
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response(bytes)),
    );
    const artifact: ManagedVmArtifact = {
      name: 'gvisor',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: '0'.repeat(128),
      url: 'https://releases.example.test/runsc.deb',
      version: 'release-test',
    };

    await expect(downloadManagedVmArtifacts(completeArtifactSet(bytes, artifact))).rejects.toThrow(
      'gvisor SHA-512 verification failed',
    );
  });

  it('rejects a verified gVisor package missing required runtime files', async (): Promise<void> => {
    const bytes: Buffer = Buffer.from('verified package bytes');
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response(bytes)),
    );
    const artifact: ManagedVmArtifact = {
      name: 'gvisor',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('hex'),
      url: 'https://releases.example.test/runsc.deb',
      version: 'release-test',
    };
    mocks.execa.mockImplementation(
      async (command: string, args: readonly string[]): Promise<ManagedVmCommandResult> =>
        await runArtifactTool(command, args, false),
    );

    await expect(downloadManagedVmArtifacts(completeArtifactSet(bytes, artifact))).rejects.toThrow(
      'Managed-VM gVisor package is missing a required runtime file',
    );
  });

  it('returns the complete verified gVisor package layout', async (): Promise<void> => {
    const bytes: Buffer = Buffer.from('verified package bytes');
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response(bytes)),
    );
    const artifact: ManagedVmArtifact = {
      name: 'gvisor',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('hex'),
      url: 'https://releases.example.test/runsc.deb',
      version: 'release-test',
    };

    const result: ManagedVmDownloadedArtifacts = await downloadManagedVmArtifacts(completeArtifactSet(bytes, artifact));
    expect(result.gvisorCheckpointGoferPath).toMatch(/\/gvisor\/usr\/bin\/gvisor-bin\/checkpointgofer$/u);
    expect(result.gvisorContainerdShimPath).toMatch(/\/gvisor\/usr\/bin\/containerd-shim-runsc-v1$/u);
    expect(result.gvisorMetricServerPath).toMatch(/\/gvisor\/usr\/bin\/gvisor-bin\/runsc-metric-server$/u);
    expect(result.gvisorRunscConfigPath).toMatch(/\/gvisor\/etc\/containerd\/runsc\.toml$/u);
    expect(result.gvisorRunscPath).toMatch(/\/gvisor\/usr\/bin\/runsc$/u);
  });
});

function completeArtifactSet(bytes: Buffer, gvisor: ManagedVmArtifact): readonly ManagedVmArtifact[] {
  const sha256: string = createHash('sha256').update(bytes).digest('hex');
  return [
    { name: 'k3s', sha256, url: 'https://releases.example.test/k3s', version: 'v1' },
    {
      name: 'k3s-install-script',
      sha256,
      url: 'https://releases.example.test/install-k3s.sh',
      version: 'v1',
    },
    { name: 'helm', sha256, url: 'https://releases.example.test/helm.tgz', version: 'v1' },
    { name: 'cert-manager', sha256, url: 'https://releases.example.test/cert-manager.yaml', version: 'v1' },
    gvisor,
  ];
}
