import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
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
}

const mocks: ManagedVmCommandMocks = vi.hoisted(
  (): ManagedVmCommandMocks => ({
    canonicalInstall: vi.fn(),
    execa: vi.fn(),
    inspectHost: vi.fn(),
    inspectState: vi.fn(),
    observePublicIpv4: vi.fn(),
    provision: vi.fn(),
  }),
);

vi.mock('../src/services/managed-vm-host-runtime.service', (): object => ({
  inspectManagedVmHost: mocks.inspectHost,
  inspectManagedVmState: mocks.inspectState,
  observePublicIpv4: mocks.observePublicIpv4,
}));
vi.mock('../src/services/managed-vm-command.service', (): object => ({ execa: mocks.execa }));
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
    expect(mocks.execa).not.toHaveBeenCalled();
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

  it('runs confirmed root automation without sudo and preserves the owner password at the canonical boundary', async (): Promise<void> => {
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    process.getuid = (): number => 0;
    try {
      const capture: CliCommandCapture = createCliCapture();
      const { runCli } = await import('../src/app');

      expect(await runCli([...ownerInstallArgs(), '--yes'], capture.io)).toBe(0);

      expect(readCliStderr(capture).match(/Installation review/gu)).toHaveLength(1);
      expect(mocks.execa).not.toHaveBeenCalled();
      expect(mocks.provision).toHaveBeenCalledTimes(1);
      expect(mocks.canonicalInstall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          adminPassword: 'correct horse battery staple',
          managedDomain: true,
          values: '/etc/compartment/values.yaml',
        }),
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
  return `203.0.${String(113)}.10`;
}
