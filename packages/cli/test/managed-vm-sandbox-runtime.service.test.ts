import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service.types';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';
import { renderManagedVmContainerdTemplate } from '../src/services/managed-vm-sandbox-runtime-config.service';

interface TestFile {
  content: Buffer;
  mode: number;
}

interface TestDirectory {
  gid: number;
  kind: 'directory' | 'file' | 'symlink';
  mode: number;
  uid: number;
}

interface RejectedContainerdDirectoryCase {
  arrange: () => void;
  expectedError: string;
  name: string;
}

interface SandboxRuntimeMocks {
  ensureManagedVmDirectory: Mock;
  execa: Mock;
  installNewManagedVmFile: Mock;
  lstat: Mock;
  mkdir: Mock;
  open: Mock;
  readFile: Mock;
  readdir: Mock;
  replaceManagedVmFile: Mock;
}

const files: Map<string, TestFile> = new Map<string, TestFile>();
const directories: Map<string, TestDirectory> = new Map<string, TestDirectory>();
const mocks: SandboxRuntimeMocks = vi.hoisted(
  (): SandboxRuntimeMocks => ({
    ensureManagedVmDirectory: vi.fn(),
    execa: vi.fn(),
    installNewManagedVmFile: vi.fn(),
    lstat: vi.fn(),
    mkdir: vi.fn(),
    open: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    replaceManagedVmFile: vi.fn(),
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
    ensureManagedVmDirectory: mocks.ensureManagedVmDirectory,
    installNewManagedVmFile: mocks.installNewManagedVmFile,
    replaceManagedVmFile: mocks.replaceManagedVmFile,
  }),
);

beforeEach((): void => {
  files.clear();
  directories.clear();
  vi.clearAllMocks();
  directories.set('/var/lib/rancher/k3s/agent/etc/containerd', {
    gid: 0,
    kind: 'directory',
    mode: 0o755,
    uid: 0,
  });
  for (const path of Object.values(artifactPaths())) {
    if (path.startsWith('/tmp/')) {
      files.set(path, { content: Buffer.from(`verified ${path}`), mode: 0o600 });
    }
  }
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.ensureManagedVmDirectory.mockImplementation(async (path: string, mode: number): Promise<string> => {
    await Promise.resolve();
    directories.set(path, { gid: 0, kind: 'directory', mode, uid: 0 });
    return 'directory';
  });
  mocks.readFile.mockImplementation(async (path: string, encoding?: string): Promise<Buffer | string> => {
    await Promise.resolve();
    if (directories.get(path)?.kind === 'file') {
      return encoding === 'utf8' ? 'unexpected K3s path content' : Buffer.from('unexpected K3s path content');
    }
    const file: TestFile | undefined = files.get(path);
    if (file === undefined) {
      throw missing();
    }
    return encoding === 'utf8' ? file.content.toString('utf8') : file.content;
  });
  mocks.lstat.mockImplementation(async (path: string): Promise<object> => {
    await Promise.resolve();
    const directory: TestDirectory | undefined = directories.get(path);
    if (directory !== undefined) {
      return {
        dev: 1,
        gid: directory.gid,
        ino: inode(path),
        isDirectory: (): boolean => directory.kind === 'directory',
        isFile: (): boolean => directory.kind === 'file',
        isSymbolicLink: (): boolean => directory.kind === 'symlink',
        mode: directory.mode,
        uid: directory.uid,
      };
    }
    const file: TestFile | undefined = files.get(path);
    if (file === undefined) {
      throw missing();
    }
    return {
      dev: 1,
      ino: inode(path),
      isDirectory: (): boolean => false,
      isFile: (): boolean => true,
      isSymbolicLink: (): boolean => false,
      mode: file.mode,
    };
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
  mocks.replaceManagedVmFile.mockImplementation(
    async (destination: string, _expectedIdentity: string, content: Buffer | string, mode: number): Promise<string> => {
      await Promise.resolve();
      files.set(destination, { content: Buffer.isBuffer(content) ? content : Buffer.from(content), mode });
      return 'replacement-identity';
    },
  );
});

describe('managed VM sandbox runtime installation', (): void => {
  it('upgrades the legacy handler before verifying the build runtime', async (): Promise<void> => {
    mocks.execa.mockResolvedValue({ exitCode: 0, stderr: '', stdout: managedVmReleaseMetadata.gvisorVersion });
    files.set('/var/lib/rancher/k3s/agent/etc/containerd/config.toml', {
      content: Buffer.from(
        'io.containerd.runsc.v1 /etc/containerd/runsc.toml /etc/containerd/runsc-build.toml pod_annotations = ["dev.gvisor.spec.mount.*"]',
      ),
      mode: 0o600,
    });
    files.set('/tmp/runsc.toml', { content: Buffer.from('[runsc_config]\n  rootless = true\n'), mode: 0o600 });
    const { installManagedVmSandboxRuntime } = await import('../src/services/managed-vm-sandbox-runtime.service');
    const { upgradeManagedVmBuildSandboxRuntime } =
      await import('../src/services/managed-vm-build-runtime-upgrade.service');
    await installManagedVmSandboxRuntime(artifacts());
    const templatePath: string = '/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl';
    const currentTemplate: Buffer = Buffer.from(renderManagedVmContainerdTemplate());
    files.set(templatePath, { content: Buffer.from(renderManagedVmContainerdTemplate(false)), mode: 0o600 });
    files.delete('/etc/containerd/runsc-build.toml');

    const identities: Readonly<Record<string, string>> = await upgradeManagedVmBuildSandboxRuntime();
    expect(identities['/etc/containerd/runsc-build.toml']).toMatch(/^file:0600:/u);
    expect(identities[templatePath]).toMatch(/^file:0600:/u);
    expect(mocks.installNewManagedVmFile).toHaveBeenCalledWith(
      '/etc/containerd/runsc-build.toml',
      expect.any(Buffer),
      0o600,
    );
    expect(mocks.replaceManagedVmFile).toHaveBeenCalledOnce();
    expect(files.get(templatePath)?.content).toEqual(currentTemplate);
  });

  it('rejects a changed partial install on retry', async (): Promise<void> => {
    mocks.execa.mockRejectedValueOnce(new Error('k3s restart failed'));
    const { installManagedVmSandboxRuntime } = await import('../src/services/managed-vm-sandbox-runtime.service');

    await expect(installManagedVmSandboxRuntime(artifacts())).rejects.toThrow('k3s restart failed');
    files.get('/usr/local/bin/runsc')!.content = Buffer.from('concurrent runsc change');

    await expect(installManagedVmSandboxRuntime(artifacts())).rejects.toThrow(
      'provisioning refuses unexpected content at /usr/local/bin/runsc',
    );
  });

  it.each<RejectedContainerdDirectoryCase>([
    {
      arrange: (): void => setContainerdDirectory({ mode: 0o700 }),
      expectedError: 'refuses an unexpected K3s containerd directory',
      name: 'mode 0700',
    },
    {
      arrange: (): void => setContainerdDirectory({ mode: 0o775 }),
      expectedError: 'refuses an unexpected K3s containerd directory',
      name: 'group-writable mode',
    },
    {
      arrange: (): void => setContainerdDirectory({ gid: 1000 }),
      expectedError: 'refuses an unexpected K3s containerd directory',
      name: 'non-root group',
    },
    {
      arrange: (): void => setContainerdDirectory({ uid: 1000 }),
      expectedError: 'refuses an unexpected K3s containerd directory',
      name: 'non-root owner',
    },
    {
      arrange: (): void => {
        directories.delete('/var/lib/rancher/k3s/agent/etc/containerd');
      },
      expectedError: 'refuses an unexpected K3s containerd directory',
      name: 'missing path',
    },
    {
      arrange: (): void => setContainerdDirectory({ kind: 'file' }),
      expectedError: 'refuses an unexpected K3s containerd directory',
      name: 'regular file',
    },
    {
      arrange: (): void => setContainerdDirectory({ kind: 'symlink' }),
      expectedError: 'Managed-VM owned path has an unsupported type',
      name: 'symbolic link',
    },
  ])(
    'rejects a non-canonical K3s containerd directory with $name',
    async ({ arrange, expectedError }: RejectedContainerdDirectoryCase): Promise<void> => {
      arrange();
      const { installManagedVmSandboxRuntime } = await import('../src/services/managed-vm-sandbox-runtime.service');

      await expect(installManagedVmSandboxRuntime(artifacts())).rejects.toThrow(expectedError);
      expect(directories.has('/etc/containerd')).toBe(false);
      expect(directories.has('/usr/local/bin/gvisor-bin')).toBe(false);
    },
  );
});

function setContainerdDirectory(overrides: Partial<TestDirectory>): void {
  directories.set('/var/lib/rancher/k3s/agent/etc/containerd', {
    gid: 0,
    kind: 'directory',
    mode: 0o755,
    uid: 0,
    ...overrides,
  });
}

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
