import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service.types';

interface TestFile {
  content: Buffer;
  mode: number;
}

interface SandboxRuntimeMocks {
  execa: Mock;
  installNewManagedVmFile: Mock;
  lstat: Mock;
  mkdir: Mock;
  open: Mock;
  readFile: Mock;
  readdir: Mock;
}

const files: Map<string, TestFile> = new Map<string, TestFile>();
const mocks: SandboxRuntimeMocks = vi.hoisted(
  (): SandboxRuntimeMocks => ({
    execa: vi.fn(),
    installNewManagedVmFile: vi.fn(),
    lstat: vi.fn(),
    mkdir: vi.fn(),
    open: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
  }),
);

vi.mock(
  'node:fs/promises',
  (): Record<string, Mock> => ({
    lstat: mocks.lstat,
    mkdir: mocks.mkdir,
    open: mocks.open,
    readFile: mocks.readFile,
    readdir: mocks.readdir,
  }),
);
vi.mock('../src/services/managed-vm-command.service', (): { execa: Mock } => ({ execa: mocks.execa }));
vi.mock(
  '../src/services/managed-vm-cluster.service',
  (): Record<string, Mock> => ({
    waitForManagedVmKubernetes: vi.fn(),
  }),
);
vi.mock(
  '../src/services/kubernetes-sandbox-runtime-preflight.service',
  (): Record<string, Mock> => ({
    verifyKubernetesSandboxRuntime: vi.fn(),
  }),
);
vi.mock(
  '../src/services/managed-vm-owned-file.service',
  (): Record<string, Mock> => ({
    ensureManagedVmDirectory: vi.fn(async (): Promise<'directory'> => await Promise.resolve('directory')),
    installNewManagedVmFile: mocks.installNewManagedVmFile,
  }),
);

beforeEach((): void => {
  files.clear();
  vi.clearAllMocks();
  for (const path of Object.values(artifactPaths())) {
    if (path.startsWith('/tmp/')) {
      files.set(path, { content: Buffer.from(`verified ${path}`), mode: 0o600 });
    }
  }
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.readFile.mockImplementation(async (path: string): Promise<Buffer> => {
    await Promise.resolve();
    const file: TestFile | undefined = files.get(path);
    if (file === undefined) {
      throw missing();
    }
    return file.content;
  });
  mocks.lstat.mockImplementation(async (path: string): Promise<object> => {
    await Promise.resolve();
    const file: TestFile | undefined = files.get(path);
    if (file === undefined) {
      throw missing();
    }
    return { dev: 1, ino: inode(path), isFile: (): boolean => true, mode: file.mode };
  });
  mocks.open.mockImplementation(async (path: string): Promise<object> => {
    await Promise.resolve();
    const file: TestFile | undefined = files.get(path);
    if (file === undefined) {
      throw missing();
    }
    return {
      close: async (): Promise<void> => await Promise.resolve(),
      readFile: async (): Promise<Buffer> => await Promise.resolve(file.content),
      stat: async (): Promise<object> =>
        await Promise.resolve({ dev: 1, ino: inode(path), isFile: (): boolean => true, mode: file.mode }),
    };
  });
  mocks.installNewManagedVmFile.mockImplementation(
    async (destination: string, content: Buffer, mode: number): Promise<string> => {
      await Promise.resolve();
      const existing: TestFile | undefined = files.get(destination);
      if (existing !== undefined) {
        if (existing.mode !== mode || !existing.content.equals(content)) {
          throw new Error(`Managed-VM provisioning refuses unexpected content at ${destination}.`);
        }
        throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      }
      files.set(destination, { content, mode });
      return 'identity';
    },
  );
  mocks.readdir.mockImplementation(async (): Promise<object[]> => {
    await Promise.resolve();
    return ['checkpointgofer', 'runsc-metric-server']
      .filter((name: string): boolean => files.has(`/usr/local/bin/gvisor-bin/${name}`))
      .map((name: string): object => ({ isFile: (): boolean => true, name }));
  });
});

describe('managed VM sandbox runtime installation', (): void => {
  it('rejects a changed partial install on retry', async (): Promise<void> => {
    mocks.execa.mockRejectedValueOnce(new Error('k3s restart failed'));
    const { installManagedVmSandboxRuntime } = await import('../src/services/managed-vm-sandbox-runtime.service');

    await expect(installManagedVmSandboxRuntime(artifacts())).rejects.toThrow('k3s restart failed');
    files.get('/usr/local/bin/runsc')!.content = Buffer.from('concurrent runsc change');

    await expect(installManagedVmSandboxRuntime(artifacts())).rejects.toThrow(
      'provisioning refuses unexpected content at /usr/local/bin/runsc',
    );
  });
});

function artifacts(): ManagedVmDownloadedArtifacts {
  return { ...artifactPaths(), directory: '/tmp/managed-vm' };
}

function artifactPaths(): Omit<ManagedVmDownloadedArtifacts, 'directory'> {
  return {
    certManagerManifestPath: '/tmp/cert-manager.yaml',
    gvisorCheckpointGoferPath: '/tmp/checkpointgofer',
    gvisorContainerdShimPath: '/tmp/containerd-shim-runsc-v1',
    gvisorMetricServerPath: '/tmp/runsc-metric-server',
    gvisorRunscConfigPath: '/tmp/runsc.toml',
    gvisorRunscPath: '/tmp/runsc',
    helmPath: '/tmp/helm',
    k3sInstallScriptPath: '/tmp/install-k3s.sh',
    k3sPath: '/tmp/k3s',
  };
}

function missing(): Error {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

function inode(path: string): number {
  return [...path].reduce((value: number, character: string): number => value + character.codePointAt(0)!, 1);
}
