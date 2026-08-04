import type {
  ManagedVmHostInventory,
  ManagedVmObservedState,
  ManagedVmPortConflict,
  ManagedVmPreflightCheck,
  ManagedVmPreflightResult,
  ManagedVmStateClassification,
} from './managed-vm-provisioning.types';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';

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
      inventory.reachableEndpoints.length === 6,
      `${String(inventory.reachableEndpoints.length)}/6 endpoints reachable`,
    ),
    check('public-ipv4', isPublicIpv4(publicAddress), publicAddress),
    check(
      'public-address-match',
      inventory.localIpv4Addresses.includes(publicAddress),
      'local and observed IPv4 agree',
    ),
    check('host-state', classification === 'fresh' || classification === 'resume', classification),
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
  return (
    inventory.routeCidrs.includes(managedVmReleaseMetadata.podCidr) ||
    inventory.routeCidrs.includes(managedVmReleaseMetadata.serviceCidr)
  );
}

function isPublicIpv4(value: string): boolean {
  const parts: number[] = value.split('.').map(Number);
  const invalidPart: boolean = parts.some((part: number): boolean => !Number.isInteger(part) || part < 0 || part > 255);
  if (parts.length !== 4 || invalidPart) {
    return false;
  }
  const first: number = parts[0] ?? -1;
  const second: number = parts[1] ?? -1;
  if (first === 10 || first === 127 || first === 0) {
    return false;
  }
  if (first === 192 && second === 168) {
    return false;
  }
  return !(first === 172 && second >= 16 && second <= 31);
}
