import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service.types';

interface TestFile {
  content: Buffer;
  mode: number;
}

interface TestWriteOptions {
  mode: number;
}

interface SandboxRuntimeMocks {
  chmod: Mock;
  execa: Mock;
  link: Mock;
  lstat: Mock;
  mkdir: Mock;
  open: Mock;
  readFile: Mock;
  readdir: Mock;
  unlink: Mock;
  writeFile: Mock;
}

const files: Map<string, TestFile> = new Map<string, TestFile>();
const mocks: SandboxRuntimeMocks = vi.hoisted(
  (): SandboxRuntimeMocks => ({
    chmod: vi.fn(),
    execa: vi.fn(),
    link: vi.fn(),
    lstat: vi.fn(),
    mkdir: vi.fn(),
    open: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
  }),
);

vi.mock(
  'node:fs/promises',
  (): Record<string, Mock> => ({
    chmod: mocks.chmod,
    link: mocks.link,
    lstat: mocks.lstat,
    mkdir: mocks.mkdir,
    open: mocks.open,
    readFile: mocks.readFile,
    readdir: mocks.readdir,
    unlink: mocks.unlink,
    writeFile: mocks.writeFile,
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
  mocks.writeFile.mockImplementation(
    async (path: string, content: Buffer, options: TestWriteOptions): Promise<void> => {
      await Promise.resolve();
      if (files.has(path)) {
        throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      }
      files.set(path, { content, mode: options.mode });
    },
  );
  mocks.chmod.mockImplementation(async (path: string, mode: number): Promise<void> => {
    await Promise.resolve();
    files.get(path)!.mode = mode;
  });
  mocks.link.mockImplementation(async (source: string, destination: string): Promise<void> => {
    await Promise.resolve();
    if (files.has(destination)) {
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    }
    files.set(destination, files.get(source)!);
  });
  mocks.unlink.mockImplementation(async (path: string): Promise<void> => {
    await Promise.resolve();
    files.delete(path);
  });
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

  it('reconciles exact transaction links left by an interrupted install', async (): Promise<void> => {
    const runsc: TestFile = { content: Buffer.from('verified /tmp/runsc'), mode: 0o755 };
    const checkpointGofer: TestFile = { content: Buffer.from('verified /tmp/checkpointgofer'), mode: 0o755 };
    files.set('/usr/local/bin/runsc', runsc);
    files.set('/usr/local/bin/runsc.compartment-installing', runsc);
    files.set('/usr/local/bin/gvisor-bin/checkpointgofer', checkpointGofer);
    files.set('/usr/local/bin/gvisor-bin/checkpointgofer.compartment-installing', checkpointGofer);
    mocks.execa.mockRejectedValueOnce(new Error('k3s restart failed'));
    const { installManagedVmSandboxRuntime } = await import('../src/services/managed-vm-sandbox-runtime.service');

    await expect(installManagedVmSandboxRuntime(artifacts())).rejects.toThrow('k3s restart failed');
    expect(files.has('/usr/local/bin/runsc.compartment-installing')).toBe(false);
    expect(files.has('/usr/local/bin/gvisor-bin/checkpointgofer.compartment-installing')).toBe(false);
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
