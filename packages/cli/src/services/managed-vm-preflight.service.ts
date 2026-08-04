import type {
  ManagedVmHostInventory,
  ManagedVmObservedState,
  ManagedVmPortConflict,
  ManagedVmPreflightCheck,
  ManagedVmPreflightResult,
  ManagedVmStateClassification,
} from './managed-vm-provisioning.types';
import { managedVmRequiredEndpointCount } from './managed-vm-network.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { areIpv4CidrsOverlapping, isGloballyRoutableIpv4 } from './managed-vm-network-address.service';

const minimumCpuCount: number = 2;
const minimumMemoryBytes: number = 4 * 1024 * 1024 * 1024;
const minimumFreeBytes: number = 50 * 1024 * 1024 * 1024;
const managedListenerOwners: ReadonlySet<string> = new Set(['k3s', 'traefik']);

export function evaluateManagedVmPreflight(
  inventory: ManagedVmHostInventory,
  state: ManagedVmObservedState,
  publicAddress: string,
): ManagedVmPreflightResult {
  const classification: ManagedVmStateClassification = classifyManagedVmState(state);
  return {
    checks: createPreflightChecks(inventory, classification, publicAddress),
    classification,
    inventory,
    metadata: managedVmReleaseMetadata,
    publicAddress,
  };
}

function createPreflightChecks(
  inventory: ManagedVmHostInventory,
  classification: ManagedVmStateClassification,
  publicAddress: string,
): ManagedVmPreflightCheck[] {
  return [
    check('operating-system', inventory.osId === 'ubuntu' && inventory.osVersion === '24.04', 'Ubuntu 24.04 LTS'),
    check('architecture', inventory.architecture === 'x86_64', 'x86_64'),
    check('systemd', inventory.systemd, 'systemd is running'),
    check('sudo', inventory.sudoAvailable, 'root or sudo escalation is available'),
    check('archive-extractor', inventory.archiveExtractorAvailable, 'bzip2 is available'),
    check('cgroup-v2', inventory.cgroupV2, 'cgroup v2'),
    check('kernel-modules', inventory.requiredKernelModules, 'overlay, br_netfilter, and nf_tables'),
    check('clock', inventory.clockSynchronized, 'system clock is synchronized'),
    check('cpu', inventory.cpuCount >= minimumCpuCount, `${String(inventory.cpuCount)} CPUs`),
    check('memory', inventory.memoryBytes >= minimumMemoryBytes, `${String(inventory.memoryBytes)} bytes`),
    check('storage', inventory.freeBytes >= minimumFreeBytes, `${String(inventory.freeBytes)} bytes free`),
    check('inodes', inventory.freeInodes > 100_000, `${String(inventory.freeInodes)} inodes free`),
    ...createNetworkChecks(inventory, classification, publicAddress),
  ];
}

function createNetworkChecks(
  inventory: ManagedVmHostInventory,
  classification: ManagedVmStateClassification,
  publicAddress: string,
): ManagedVmPreflightCheck[] {
  const retainedManagedCluster: boolean = classification === 'resume';
  return [
    ...createConflictChecks(inventory, retainedManagedCluster),
    check('hostname', inventory.hostname.trim() !== '', inventory.hostname),
    check('public-interface', inventory.publicInterface !== '', inventory.publicInterface),
    check('firewall', inventory.firewall !== 'firewalld', `${inventory.firewall} firewall classified`),
    check(
      'downloads',
      inventory.reachableEndpoints.length === managedVmRequiredEndpointCount,
      `${String(inventory.reachableEndpoints.length)}/${String(managedVmRequiredEndpointCount)} endpoints reachable`,
    ),
    ...createPublicAddressChecks(inventory, publicAddress),
    check('host-state', classification === 'fresh' || classification === 'resume', classification),
  ];
}

function createPublicAddressChecks(
  inventory: ManagedVmHostInventory,
  publicAddress: string,
): ManagedVmPreflightCheck[] {
  const isPublicIpv4: boolean = isGloballyRoutableIpv4(publicAddress);
  const matchesHost: boolean = inventory.localIpv4Addresses.includes(publicAddress);
  const localAddresses: string =
    inventory.localIpv4Addresses.length === 0 ? 'none' : inventory.localIpv4Addresses.join(', ');
  return [
    check(
      'public-ipv4',
      isPublicIpv4,
      isPublicIpv4
        ? `public IPv4 ${publicAddress}`
        : `observed address ${publicAddress} is not a globally routable IPv4 address`,
    ),
    check(
      'public-address-match',
      matchesHost,
      matchesHost
        ? `local and observed IPv4 agree (${publicAddress})`
        : `observed public IPv4 ${publicAddress} is not assigned to this host; local IPv4 addresses: ${localAddresses}`,
    ),
  ];
}

function createConflictChecks(
  inventory: ManagedVmHostInventory,
  retainedManagedCluster: boolean,
): ManagedVmPreflightCheck[] {
  return [
    check('ports', hasNoForeignPortConflicts(inventory, retainedManagedCluster), formatPortConflicts(inventory)),
    check(
      'network-cidrs',
      retainedManagedCluster || !hasManagedCidrConflict(inventory),
      'pod and service CIDRs are free',
    ),
  ];
}

function hasNoForeignPortConflicts(inventory: ManagedVmHostInventory, retainedManagedCluster: boolean): boolean {
  if (!retainedManagedCluster) {
    return inventory.portsInUse.length === 0;
  }
  return inventory.portsInUse.every((conflict: ManagedVmPortConflict): boolean =>
    managedListenerOwners.has(conflict.owner),
  );
}

export function assertManagedVmPreflight(result: ManagedVmPreflightResult): void {
  const failures: readonly ManagedVmPreflightCheck[] = result.checks.filter(
    (item: ManagedVmPreflightCheck): boolean => !item.passed,
  );
  if (failures.length === 0) {
    return;
  }
  throw new Error(`Managed-VM preflight failed:\n${failures.map(formatFailure).join('\n')}`);
}

function classifyManagedVmState(state: ManagedVmObservedState): ManagedVmStateClassification {
  if (state.lockOwner !== undefined) {
    return 'locked';
  }
  if (state.provisionerStateExists && !state.ownedConfigMatches) {
    return 'inconsistent';
  }
  if (state.provisionerStateExists) {
    return 'resume';
  }
  return state.foreignPaths.length === 0 ? 'fresh' : 'foreign';
}

function formatFailure(item: ManagedVmPreflightCheck): string {
  return `- ${item.name}: ${item.detail}`;
}

function check(name: string, passed: boolean, detail: string): ManagedVmPreflightCheck {
  return { detail, name, passed };
}

function formatPortConflicts(inventory: ManagedVmHostInventory): string {
  if (inventory.portsInUse.length === 0) {
    return 'ports 80 and 443 are free';
  }
  return inventory.portsInUse
    .map((item: ManagedVmPortConflict): string => `${String(item.port)} (${item.owner})`)
    .join(', ');
}

function hasManagedCidrConflict(inventory: ManagedVmHostInventory): boolean {
  return inventory.routeCidrs.some(
    (route: string): boolean =>
      areIpv4CidrsOverlapping(route, managedVmReleaseMetadata.podCidr) ||
      areIpv4CidrsOverlapping(route, managedVmReleaseMetadata.serviceCidr),
  );
}
