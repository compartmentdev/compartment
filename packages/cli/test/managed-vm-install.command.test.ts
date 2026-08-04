import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { ManagedVmHostInventory, ManagedVmObservedState } from '../src/services/managed-vm-provisioning.types';
import { createCliCapture, readCliStderr, readCliStdout, type CliCommandCapture } from './cli-test.harness';

type GetUid = () => number;

interface ManagedVmCommandMocks {
  canonicalInstall: Mock;
  execa: Mock;
  inspectHost: Mock;
  inspectState: Mock;
  observePublicIpv4: Mock;
  provision: Mock;
  runCommand: Mock;
}

const mocks: ManagedVmCommandMocks = vi.hoisted(
  (): ManagedVmCommandMocks => ({
    canonicalInstall: vi.fn(),
    execa: vi.fn(),
    inspectHost: vi.fn(),
    inspectState: vi.fn(),
    observePublicIpv4: vi.fn(),
    provision: vi.fn(),
    runCommand: vi.fn(),
  }),
);

vi.mock('../src/services/managed-vm-host-runtime.service', (): object => ({
  inspectManagedVmHost: mocks.inspectHost,
  inspectManagedVmState: mocks.inspectState,
  observePublicIpv4: mocks.observePublicIpv4,
}));
vi.mock('../src/services/managed-vm-command.service', (): object => ({ execa: mocks.execa }));
vi.mock('../src/command-runner', (): object => ({ runCommand: mocks.runCommand }));
vi.mock('../src/services/managed-vm-provisioner.service', (): object => ({
  provisionManagedVmCluster: mocks.provision,
}));
vi.mock('../src/commands/install/install.command.kubernetes', (): object => ({
  executeCanonicalKubernetesInstallCommand: mocks.canonicalInstall,
}));
vi.mock('../src/services/managed-vm-state.service', async (importOriginal: <T>() => Promise<T>): Promise<object> => {
  const original: object = await importOriginal<object>();
  return { ...original, persistManagedVmStage: vi.fn() };
});

describe('managed VM install command boundary', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.inspectHost.mockResolvedValue(supportedInventory());
    mocks.inspectState.mockResolvedValue(freshState());
    mocks.observePublicIpv4.mockResolvedValue(`ip=${publicAddress()}\n`);
    mocks.provision.mockResolvedValue({ completedStage: 'verifying-prerequisites' });
    mocks.execa.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
    mocks.runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'yes\n' });
  });

  it('prints the complete read-only preflight as JSON without reviewing or mutating', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const { runCli } = await import('../src/app');

    expect(await runCli(['install', '--target', 'vm', '--check', '--output', 'json'], capture.io)).toBe(0);

    expect(JSON.parse(readCliStdout(capture))).toMatchObject({
      classification: 'fresh',
      publicAddress: publicAddress(),
    });
    expect(readCliStderr(capture)).not.toContain('Installation review');
    expect(mocks.observePublicIpv4).toHaveBeenCalledWith('https://1.1.1.1/cdn-cgi/trace');
    expect(mocks.execa).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.canonicalInstall).not.toHaveBeenCalled();
  });

  it('explains the observed and local addresses before mutation when public IPv4 does not match', async (): Promise<void> => {
    const localAddress: string = `46.225.${String(172)}.160`;
    const observedAddress: string = `8.8.${String(8)}.8`;
    mocks.inspectHost.mockResolvedValue({ ...supportedInventory(), localIpv4Addresses: [localAddress] });
    mocks.observePublicIpv4.mockResolvedValue(`ip=${observedAddress}\n`);
    const capture: CliCommandCapture = createCliCapture();
    const { runCli } = await import('../src/app');

    expect(await runCli(['install', '--target', 'vm', '--check'], capture.io)).toBe(1);

    expect(readCliStderr(capture)).toContain(`observed public IPv4 ${observedAddress}`);
    expect(readCliStderr(capture)).toContain(`local IPv4 addresses: ${localAddress}`);
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.canonicalInstall).not.toHaveBeenCalled();
  });

  it('shows one mutation review and does not request sudo when confirmation is declined', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('n\n');
    const { runCli } = await import('../src/app');

    const exitCode: number = await runCli(ownerInstallArgs(), capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture).match(/Installation review/gu)).toHaveLength(1);
    expect(readCliStderr(capture)).toContain('cancelled before host changes');
    expect(mocks.execa).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('stops at foreign Kubernetes state before review, sudo, or canonical installation', async (): Promise<void> => {
    mocks.inspectState.mockResolvedValue({
      foreignPaths: ['/etc/kubernetes/admin.conf'],
      ownedConfigMatches: false,
      provisionerStateExists: false,
    });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    const { runCli } = await import('../src/app');

    expect(await runCli(ownerInstallArgs(), capture.io)).toBe(1);

    expect(readCliStderr(capture)).toContain('host-state');
    expect(readCliStderr(capture)).not.toContain('Installation review');
    expect(mocks.execa).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.canonicalInstall).not.toHaveBeenCalled();
  });

  it('keeps an explicit existing-Kubernetes install on the canonical command path', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const { runCli } = await import('../src/app');

    expect(await runCli(['install', '--target', 'kubernetes', '--managed-domain'], capture.io)).toBe(0);

    expect(mocks.canonicalInstall).toHaveBeenCalledTimes(1);
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.execa).not.toHaveBeenCalled();
  });

  it('offers managed Kubernetes when automatic discovery finds no cluster', async (): Promise<void> => {
    const originalKubeconfig: string | undefined = process.env.KUBECONFIG;
    process.env.KUBECONFIG = join(tmpdir(), 'compartment-missing-kubeconfig');
    try {
      const capture: CliCommandCapture = createCliCapture({ isTTY: true });
      capture.stdin.end('\nn\n');
      const { runCli } = await import('../src/app');

      expect(await runCli(['install', ...ownerInstallArgs().slice(3)], capture.io)).toBe(1);
      expect(readCliStderr(capture)).toContain('No usable Kubernetes cluster detected.');
      expect(readCliStderr(capture)).toContain('Kubernetes 1.30 or newer with the required APIs');
      expect(readCliStderr(capture)).toContain('Install managed Kubernetes on this VM? [Y/n]:');
      expect(readCliStderr(capture)).toContain('cancelled before host changes');
    } finally {
      if (originalKubeconfig === undefined) {
        delete process.env.KUBECONFIG;
      } else {
        process.env.KUBECONFIG = originalKubeconfig;
      }
    }
  });

  it('detects an existing cluster from a multi-path KUBECONFIG at the command boundary', async (): Promise<void> => {
    const directory: string = await mkdtemp(join(tmpdir(), 'managed-vm-kubeconfig-'));
    const kubeconfigPath: string = join(directory, 'config');
    const originalKubeconfig: string | undefined = process.env.KUBECONFIG;
    await writeFile(
      kubeconfigPath,
      `current-context: existing
contexts: [{ name: existing, context: { cluster: local, user: owner } }]
clusters: [{ name: local, cluster: { server: https://127.0.0.1:6443 } }]
users: [{ name: owner, user: {} }]
`,
    );
    process.env.KUBECONFIG = `${join(directory, 'missing')}${delimiter}${kubeconfigPath}`;
    mocks.execa.mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'yes\n' });
    try {
      const capture: CliCommandCapture = createCliCapture({ isTTY: true });
      const { runCli } = await import('../src/app');

      expect(await runCli(['install', '--managed-domain', '--check'], capture.io)).toBe(0);
      expect(mocks.canonicalInstall).toHaveBeenCalledOnce();
      expect(mocks.provision).not.toHaveBeenCalled();
    } finally {
      if (originalKubeconfig === undefined) {
        delete process.env.KUBECONFIG;
      } else {
        process.env.KUBECONFIG = originalKubeconfig;
      }
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('preserves interactively resolved owner fields during confirmed root installation', async (): Promise<void> => {
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    process.getuid = (): number => 0;
    try {
      const capture: CliCommandCapture = createCliCapture();
      capture.stdin.end('owner@example.com\nAcme\n');
      const { runCli } = await import('../src/app');

      expect(
        await runCli(
          [
            'install',
            '--target',
            'vm',
            '--admin-password',
            'correct horse battery staple',
            '--managed-domain',
            '--yes',
          ],
          capture.io,
        ),
      ).toBe(0);

      expect(readCliStderr(capture).match(/Installation review/gu)).toHaveLength(1);
      expect(mocks.execa).not.toHaveBeenCalled();
      expect(mocks.provision).toHaveBeenCalledTimes(1);
      expect(mocks.canonicalInstall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          adminPassword: 'correct horse battery staple',
          email: 'owner@example.com',
          managedDomain: true,
          organization: 'Acme',
          values: '/etc/compartment/values.yaml',
        }),
      );
    } finally {
      process.getuid = getuid;
    }
  });

  it('preserves the complete owner identity while resuming a confirmed root install', async (): Promise<void> => {
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    mocks.inspectState.mockResolvedValue({
      foreignPaths: [],
      ownedConfigMatches: true,
      provisionerStateExists: true,
    });
    process.getuid = (): number => 0;
    try {
      const capture: CliCommandCapture = createCliCapture();
      const { runCli } = await import('../src/app');

      expect(await runCli([...ownerInstallArgs(), '--yes'], capture.io)).toBe(0);

      expect(mocks.canonicalInstall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          adminPassword: 'correct horse battery staple',
          email: 'owner@example.com',
          organization: 'Acme',
        }),
      );
    } finally {
      process.getuid = getuid;
    }
  });

  it('consumes stdin password once during confirmed root automation', async (): Promise<void> => {
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    process.getuid = (): number => 0;
    try {
      const capture: CliCommandCapture = createCliCapture();
      capture.stdin.end('correct horse battery staple\n');
      const { runCli } = await import('../src/app');

      expect(
        await runCli(
          [
            'install',
            '--target',
            'vm',
            '--email',
            'owner@example.com',
            '--organization',
            'Acme',
            '--admin-password-file',
            '-',
            '--yes',
          ],
          capture.io,
        ),
      ).toBe(0);
      expect(mocks.canonicalInstall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ adminPassword: 'correct horse battery staple' }),
      );
    } finally {
      process.getuid = getuid;
    }
  });

  it('hands a confirmed non-root install to sudo without putting the password in argv', async (): Promise<void> => {
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    process.getuid = (): number => 1000;
    try {
      const capture: CliCommandCapture = createCliCapture();
      const { runCli } = await import('../src/app');

      expect(await runCli([...ownerInstallArgs(), '--yes'], capture.io)).toBe(0);

      expect(mocks.execa).toHaveBeenCalledTimes(1);
      const [command, args, options] = mocks.execa.mock.calls[0] as [string, string[], object];
      expect(command).toBe('sudo');
      expect(args).toContain('--privileged-vm-install');
      expect(args).toContain('--privileged-vm-handoff');
      expect(args).toContain('--admin-password-file');
      expect(args).not.toContain('correct horse battery staple');
      expect(options).toEqual({ stdio: 'inherit' });
      expect(mocks.provision).not.toHaveBeenCalled();
      expect(mocks.canonicalInstall).not.toHaveBeenCalled();
    } finally {
      process.getuid = getuid;
    }
  });
});

function ownerInstallArgs(): string[] {
  return [
    'install',
    '--target',
    'vm',
    '--email',
    'owner@example.com',
    '--organization',
    'Acme',
    '--admin-password',
    'correct horse battery staple',
  ];
}

function supportedInventory(): ManagedVmHostInventory {
  return {
    architecture: 'x86_64',
    cgroupV2: true,
    clockSynchronized: true,
    cpuCount: 4,
    freeBytes: 80 * 1024 * 1024 * 1024,
    freeInodes: 1_000_000,
    firewall: 'nftables',
    hostname: 'compartment-vm',
    localIpv4Addresses: [publicAddress()],
    memoryBytes: 8 * 1024 * 1024 * 1024,
    osId: 'ubuntu',
    osVersion: '24.04',
    portsInUse: [],
    publicInterface: 'ens3',
    reachableEndpoints: ['1', '2', '3', '4', '5', '6'],
    requiredKernelModules: true,
    routeCidrs: ['default'],
    sudoAvailable: true,
    systemd: true,
  };
}

function freshState(): ManagedVmObservedState {
  return { foreignPaths: [], ownedConfigMatches: false, provisionerStateExists: false };
}

function publicAddress(): string {
  return `8.8.${String(4)}.4`;
}
