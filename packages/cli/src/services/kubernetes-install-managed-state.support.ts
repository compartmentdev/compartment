import { arch, platform, release } from 'node:os';
import type {
  ManagedDomainAllocationMetadata,
  ManagedDomainAllocationOsMetadata,
  ManagedDomainReservationResponse,
} from '@compartment/contracts';
import { readCliVersion } from '../cli-build-info';
import type { ExistingKubernetesInstall } from './kubernetes-install.service.types';

export function readExistingManagedAllocation(
  existingInstall: ExistingKubernetesInstall,
): ManagedDomainReservationResponse | null {
  if (
    existingInstall.baseDomain === '' &&
    existingInstall.managedDomainAllocationId === '' &&
    existingInstall.managedDomainBrokerToken === ''
  ) {
    return null;
  }
  if (
    existingInstall.baseDomain !== '' &&
    existingInstall.managedDomainAllocationId !== '' &&
    existingInstall.managedDomainBrokerToken !== ''
  ) {
    return {
      allocationId: existingInstall.managedDomainAllocationId,
      baseDomain: existingInstall.baseDomain,
      scopedToken: existingInstall.managedDomainBrokerToken,
    };
  }
  throw new Error('The existing managed-domain install has incomplete allocation state.');
}

export function requireManagedBrokerUrl(brokerUrl: string | undefined): string {
  if (brokerUrl !== undefined) {
    return brokerUrl;
  }
  throw new Error('Managed domain install requires a broker URL.');
}

export function requireManagedDomainRequestedLabelSource(value: string | undefined): string {
  if (value !== undefined && value !== '') {
    return value;
  }
  throw new Error('Managed domain install requires an organization label source.');
}

export function buildManagedDomainAllocationMetadata(): ManagedDomainAllocationMetadata {
  const cliVersion: string = readCliVersion();
  const os: ManagedDomainAllocationOsMetadata = { arch: arch(), platform: platform(), release: release() };
  return {
    cliVersion,
    os,
    runtimeVersion: cliVersion,
  };
}
