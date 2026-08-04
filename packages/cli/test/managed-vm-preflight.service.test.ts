import { describe, expect, it } from 'vitest';
import { assertManagedVmPreflight, evaluateManagedVmPreflight } from '../src/services/managed-vm-preflight.service';
import type {
  ManagedVmHostInventory,
  ManagedVmObservedState,
  ManagedVmPreflightCheck,
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
    expect(result.checks.every((check: ManagedVmPreflightCheck): boolean => check.passed)).toBe(true);
    expect((): void => assertManagedVmPreflight(result)).not.toThrow();
    expect(result.metadata.k3sChannel).toBe('compartment-stable-1.35');
  });

  it('reports resource, port, route, address, and foreign-state failures together', (): void => {
    const inventory: ManagedVmHostInventory = {
      ...supportedInventory(),
      cpuCount: 1,
      portsInUse: [{ owner: 'nginx', port: 443 }],
      routeCidrs: [`10.${String(42)}.0.0/16`],
    };
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      inventory,
      { foreignPaths: ['/etc/kubernetes/admin.conf'], ownedConfigMatches: false, provisionerStateExists: false },
      `192.${String(168)}.1.5`,
    );
    expect((): void => assertManagedVmPreflight(result)).toThrow(
      /cpu.*ports.*network-cidrs.*public-ipv4.*host-state/su,
    );
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

    expect(result.checks.every((check: ManagedVmPreflightCheck): boolean => check.passed)).toBe(true);
  });

  it('rejects ownerless listeners while resuming retained state', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), portsInUse: [{ owner: 'unknown process', port: 443 }] },
      { foreignPaths: [], ownedConfigMatches: true, provisionerStateExists: true },
      publicAddress(),
    );

    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'ports')?.passed).toBe(false);
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
        result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'network-cidrs')?.passed,
      ).toBe(false);
    },
  );

  it('accepts a non-overlapping route', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), routeCidrs: [cidr([10, 44, 0, 0], 16)] },
      freshState(),
      publicAddress(),
    );

    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'network-cidrs')?.passed).toBe(
      true,
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
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), localIpv4Addresses: [address] },
      freshState(),
      address,
    );
    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'public-ipv4')?.passed).toBe(
      false,
    );
  });

  it('rejects a foreign listener while resuming managed state', (): void => {
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), portsInUse: [{ owner: 'nginx', port: 443 }] },
      { foreignPaths: [], ownedConfigMatches: true, provisionerStateExists: true },
      publicAddress(),
    );

    expect(result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'ports')?.passed).toBe(false);
  });

  it('reports the observed and local addresses when the public IPv4 is not assigned to the host', (): void => {
    const localAddresses: readonly string[] = [ipv4([46, 225, 172, 160]), ipv4([10, 0, 0, 2])];
    const observedAddress: string = ipv4([8, 8, 8, 8]);
    const result: ManagedVmPreflightResult = evaluateManagedVmPreflight(
      { ...supportedInventory(), localIpv4Addresses: localAddresses },
      freshState(),
      observedAddress,
    );

    expect(
      result.checks.find((item: ManagedVmPreflightCheck): boolean => item.name === 'public-address-match'),
    ).toEqual({
      detail: `observed public IPv4 ${observedAddress} is not assigned to this host; local IPv4 addresses: ${localAddresses.join(', ')}`,
      name: 'public-address-match',
      passed: false,
    });
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
    localIpv4Addresses: [publicAddress()],
    memoryBytes: 8 * 1024 * 1024 * 1024,
    osId: 'ubuntu',
    osVersion: '24.04',
    portsInUse: [],
    publicInterface: 'ens3',
    routeCidrs: ['default'],
    requiredKernelModules: true,
    reachableEndpoints: ['1', '2', '3', '4', '5', '6', '7', '8'],
    systemd: true,
    sudoAvailable: true,
  };
}

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
