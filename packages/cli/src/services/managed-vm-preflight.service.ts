import type {
  ManagedVmHostInventory,
  ManagedVmObservedState,
  ManagedVmPortConflict,
  ManagedVmPreflightCheck,
  ManagedVmPreflightCheckStatus,
  ManagedVmPreflightResult,
  ManagedVmStateClassification,
} from './managed-vm-provisioning.types';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { areIpv4CidrsOverlapping, isGloballyRoutableIpv4 } from './managed-vm-network-address.service';

const gibibyte: number = 1024 * 1024 * 1024;
const recommendedCpuCount: number = 2;
const recommendedMemoryBytes: number = 8 * gibibyte;
const minimumFreeBytes: number = 20 * gibibyte;
const recommendedFreeBytes: number = 50 * gibibyte;
const recommendedFreeInodes: number = 100_000;
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
    createOperatingSystemCheck(inventory),
    check('architecture', inventory.architecture === 'x86_64', 'x86_64'),
    check('systemd', inventory.systemd, 'systemd is running'),
    check('sudo', inventory.sudoAvailable, 'root or sudo escalation is available'),
    check('archive-extractor', inventory.archiveExtractorAvailable, 'dpkg-deb is available'),
    check('cgroup-v2', inventory.cgroupV2, 'cgroup v2'),
    ...createResourceChecks(inventory),
    ...createNetworkChecks(inventory, classification, publicAddress),
  ];
}

function createOperatingSystemCheck(inventory: ManagedVmHostInventory): ManagedVmPreflightCheck {
  return warningCheck(
    'operating-system',
    inventory.osId === 'ubuntu' && inventory.osVersion === '24.04',
    'Ubuntu 24.04 LTS',
    `${inventory.osId} ${inventory.osVersion}; tested on Ubuntu 24.04 LTS`,
  );
}

function createResourceChecks(inventory: ManagedVmHostInventory): ManagedVmPreflightCheck[] {
  return [
    check('clock', inventory.clockSynchronized, 'system clock is synchronized'),
    warningCheck('cpu', inventory.cpuCount >= recommendedCpuCount, `${String(inventory.cpuCount)} CPUs`),
    warningCheck('memory', inventory.memoryBytes >= recommendedMemoryBytes, `${String(inventory.memoryBytes)} bytes`),
    createStorageCheck(inventory.freeBytes),
    warningCheck(
      'inodes',
      inventory.freeInodes >= recommendedFreeInodes,
      `${String(inventory.freeInodes)} inodes free`,
    ),
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
    ...createPublicAddressChecks(publicAddress),
    check('host-state', classification === 'fresh' || classification === 'resume', classification),
  ];
}

function createPublicAddressChecks(publicAddress: string): ManagedVmPreflightCheck[] {
  const isPublicIpv4: boolean = isGloballyRoutableIpv4(publicAddress);
  return [
    check(
      'public-ipv4',
      isPublicIpv4,
      isPublicIpv4
        ? `public IPv4 ${publicAddress}`
        : `observed address ${publicAddress} is not a globally routable IPv4 address`,
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
    (item: ManagedVmPreflightCheck): boolean => item.status === 'failed',
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

function createStorageCheck(freeBytes: number): ManagedVmPreflightCheck {
  const detail: string = `${String(freeBytes)} bytes free`;
  return freeBytes < minimumFreeBytes
    ? check('storage', false, detail)
    : warningCheck('storage', freeBytes >= recommendedFreeBytes, detail);
}

function check(name: string, passed: boolean, detail: string): ManagedVmPreflightCheck {
  return passed ? { detail, name, passed: true, status: 'passed' } : { detail, name, passed: false, status: 'failed' };
}

function warningCheck(
  name: string,
  recommended: boolean,
  detail: string,
  warningDetail: string = detail,
): ManagedVmPreflightCheck {
  const status: ManagedVmPreflightCheckStatus = recommended ? 'passed' : 'warning';
  return { detail: recommended ? detail : warningDetail, name, passed: true, status };
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
