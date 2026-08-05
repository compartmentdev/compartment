import { describe, expect, it } from 'vitest';
import { assertManagedVmPreflight, evaluateManagedVmPreflight } from '../src/services/managed-vm-preflight.service';
import type {
  ManagedVmHostInventory,
  ManagedVmObservedState,
  ManagedVmPreflightCheck,
  ManagedVmPreflightCheckStatus,
  ManagedVmPreflightResult,
  ManagedVmStateClassification,
} from '../src/services/managed-vm-provisioning.types';

describe('managed VM preflight', (): void => {
  it.each([
    [{ foreignPaths: [], ownedConfigMatches: false, provisionerStateExists: false }, 'fresh'],
    [{ foreignPaths: [], ownedConfigMatches: true, provisionerStateExists: true }, 'resume'],
    [
      { foreignPaths: ['/etc/kubernetes/admin.conf'], ownedConfigMatches: false, provisionerStateExists: false },
      'foreign',
    ],
    [{ foreignPaths: [], ownedConfigMatches: false, provisionerStateExists: true }, 'inconsistent'],
    [{ foreignPaths: [], lockOwner: '42', ownedConfigMatches: true, provisionerStateExists: true }, 'locked'],
  ] satisfies readonly [ManagedVmObservedState, ManagedVmStateClassification][])(
    'classifies host state without adoption',
    (state: ManagedVmObservedState, result: ManagedVmStateClassification): void => {
      expect(evaluateManagedVmPreflight(supportedInventory(), state, publicAddress()).classification).toBe(result);
    },
  );

  it('accepts the narrow supported clean host contract', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      supportedInventory(),
      freshState(),
      publicAddress(),
    );
    expect(result.checks.every((check: ManagedVmPreflightCheck): boolean => check.status !== 'failed')).toBe(true);
    expect((): void => assertManagedVmPreflight(result)).not.toThrow();
    expect(result.metadata.k3sChannel).toBe('compartment-stable-1.35');
  });

  it('reports blocking resource, port, route, address, and foreign-state failures together', (): void => {
    const inventory: ManagedVmHostInventory = {
      ...supportedInventory(),
      archiveExtractorAvailable: false,
      freeBytes: 20 * gibibyte - 1,
      portsInUse: [{ owner: 'nginx', port: 443 }],
      routeCidrs: [`10.${String(42)}.0.0/16`],
    };
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      inventory,
      { foreignPaths: ['/etc/kubernetes/admin.conf'], ownedConfigMatches: false, provisionerStateExists: false },
      `192.${String(168)}.1.5`,
    );
    expect((): void => assertManagedVmPreflight(result)).toThrow(
      /archive-extractor.*storage.*ports.*network-cidrs.*public-ipv4.*host-state/su,
    );
  });

  it.each([
    [20 * gibibyte - 1, 'failed', true],
    [20 * gibibyte, 'warning', false],
    [50 * gibibyte - 1, 'warning', false],
    [50 * gibibyte, 'passed', false],
  ] as const)(
    'classifies %s free bytes as %s',
    (freeBytes: number, status: ManagedVmPreflightCheckStatus, throws: boolean): void => {
      const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
        { ...supportedInventory(), freeBytes },
        freshState(),
        publicAddress(),
      );

      expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'storage')?.status).toBe(
        status,
      );
      if (throws) {
        expect((): void => assertManagedVmPreflight(result)).toThrow();
      } else {
        expect((): void => assertManagedVmPreflight(result)).not.toThrow();
      }
    },
  );

  it('keeps recommendations visible without blocking installation', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      {
        ...supportedInventory(),
        cpuCount: 1,
        freeInodes: 99_999,
        memoryBytes: 2 * gibibyte,
        osId: 'debian',
        osVersion: '13',
      },
      freshState(),
      publicAddress(),
    );
    const warnings: readonly ManagedVmPreflightCheck[] = result.checks.filter(
      (item: ManagedVmPreflightCheck): boolean => item.status === 'warning',
    );

    expect(warnings.map((item: ManagedVmPreflightCheck): string => item.name)).toEqual([
      'operating-system',
      'cpu',
      'memory',
      'inodes',
    ]);
    expect(warnings[0]?.detail).toContain('tested on Ubuntu 24.04 LTS');
    expect((): void => assertManagedVmPreflight(result)).not.toThrow();
  });

  it('accepts managed listeners and routes while resuming retained owned state', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      {
        ...supportedInventory(),
        portsInUse: [{ owner: 'k3s', port: 443 }],
        routeCidrs: [managedPodCidr()],
      },
      { foreignPaths: [], ownedConfigMatches: true, provisionerStateExists: true },
      publicAddress(),
    );

    expect(result.checks.every((check: ManagedVmPreflightCheck): boolean => check.status !== 'failed')).toBe(true);
  });

  it('rejects ownerless listeners while resuming retained state', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), portsInUse: [{ owner: 'unknown process', port: 443 }] },
      { foreignPaths: [], ownedConfigMatches: true, provisionerStateExists: true },
      publicAddress(),
    );

    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'ports')?.status).toBe(
      'failed',
    );
  });

  it.each([cidr([10, 42, 0, 0], 15), cidr([10, 42, 0, 0], 24), cidr([10, 42, 2, 10], 32), cidr([10, 43, 0, 0], 15)])(
    'rejects overlapping route %s',
    (routeCidr: string): void => {
      const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
        { ...supportedInventory(), routeCidrs: [routeCidr] },
        freshState(),
        publicAddress(),
      );

      expect(
        result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'network-cidrs')?.status,
      ).toBe('failed');
    },
  );

  it('accepts a non-overlapping route', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), routeCidrs: [cidr([10, 44, 0, 0], 16)] },
      freshState(),
      publicAddress(),
    );

    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'network-cidrs')?.status).toBe(
      'passed',
    );
  });

  it.each([
    ipv4([100, 64, 0, 1]),
    ipv4([169, 254, 1, 1]),
    ipv4([192, 0, 2, 1]),
    ipv4([198, 51, 100, 1]),
    ipv4([203, 0, 113, 1]),
    ipv4([224, 0, 0, 1]),
  ])('rejects non-global address %s', (address: string): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(supportedInventory(), freshState(), address);
    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'public-ipv4')?.status).toBe(
      'failed',
    );
  });

  it('rejects a foreign listener while resuming managed state', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), portsInUse: [{ owner: 'nginx', port: 443 }] },
      { foreignPaths: [], ownedConfigMatches: true, provisionerStateExists: true },
      publicAddress(),
    );

    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'ports')?.status).toBe(
      'failed',
    );
  });

  it('accepts a globally routable address without requiring local interface assignment', (): void => {
    const observedAddress: string = ipv4([8, 8, 8, 8]);
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      supportedInventory(),
      freshState(),
      observedAddress,
    );

    expect(result.checks.some((item: ManagedVmPreflightCheck): boolean => item.name === 'public-address-match')).toBe(
      false,
    );
    expect((): void => assertManagedVmPreflight(result)).not.toThrow();
  });
});

function supportedInventory(): ManagedVmHostInventory {
  return {
    archiveExtractorAvailable: true,
    architecture: 'x86_64',
    cgroupV2: true,
    clockSynchronized: true,
    cpuCount: 4,
    freeBytes: 80 * 1024 * 1024 * 1024,
    freeInodes: 1_000_000,
    firewall: 'nftables',
    hostname: 'compartment-vm',
    memoryBytes: 8 * 1024 * 1024 * 1024,
    osId: 'ubuntu',
    osVersion: '24.04',
    portsInUse: [],
    publicInterface: 'ens3',
    routeCidrs: ['default'],
    systemd: true,
    sudoAvailable: true,
  };
}

const gibibyte: number = 1024 * 1024 * 1024;

function freshState(): ManagedVmObservedState {
  return { foreignPaths: [], ownedConfigMatches: false, provisionerStateExists: false };
}

function publicAddress(): string {
  return `8.8.${String(4)}.4`;
}

function managedPodCidr(): string {
  return `10.${String(42)}.0.0/16`;
}

function cidr(parts: readonly number[], prefix: number): string {
  return `${ipv4(parts)}/${String(prefix)}`;
}

function ipv4(parts: readonly number[]): string {
  return parts.join('.');
}
