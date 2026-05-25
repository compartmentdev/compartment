import { isIPv4, isIPv6 } from 'node:net';
import { arch, platform, release } from 'node:os';
import { hasText, slugifyText } from '@compartment/utils';
import {
  managedDomainRequestedLabelSourceMaxLength,
  type ManagedDomainAllocationMetadata,
  type ManagedDomainAllocationResponse,
} from '@compartment/contracts';
import { readCliVersion } from '../../cli-build-info';
import type { ManagedDomainInstallState } from '../../self-hosted-install-state.types';
import { readPublicIpAddress } from '../../public-ip';
import { allocateInstallManagedDomain } from '../../services/managed-domain.service';
import {
  readInstallBaseDomain,
  readInstallManagedDomainBrokerUrl,
  usesManagedInstallDomain,
} from './install.command.options';
import type { InstallCommandOptions } from './install.command.types';
import type { InstallCommandProgress } from './install.command.progress.types';

export interface ResolvedManagedDomainInstallState {
  managedDomain: ManagedDomainInstallState;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
}

export async function resolveManagedDomainInstallState(
  progress: InstallCommandProgress,
  options: InstallCommandOptions,
  acmeEmail: string,
  installationId: string,
  organizationName: string,
  runtimeVersion: string,
): Promise<ResolvedManagedDomainInstallState | undefined> {
  if (!usesManagedInstallDomain(options)) {
    return undefined;
  }

  const brokerUrl: string = readRequiredManagedDomainBrokerUrl(options);
  const requestedLabelSource: string = readRequestedManagedDomainLabelSource(
    organizationName,
    options.organizationSlug,
  );

  return await resolveAllocatedManagedDomainInstallState(
    progress,
    brokerUrl,
    acmeEmail,
    installationId,
    requestedLabelSource,
    runtimeVersion,
  );
}

async function resolveAllocatedManagedDomainInstallState(
  progress: InstallCommandProgress,
  brokerUrl: string,
  acmeEmail: string,
  installationId: string,
  requestedLabelSource: string,
  runtimeVersion: string,
): Promise<ResolvedManagedDomainInstallState> {
  const publicIp: string = await readManagedDomainPublicIpAddress(progress);
  const publicIngress: Pick<ResolvedManagedDomainInstallState, 'publicIngressIpv4' | 'publicIngressIpv6'> =
    readManagedDomainPublicIngress(publicIp);
  const allocation: ManagedDomainAllocationResponse = await allocateManagedDomainForInstall(
    progress,
    brokerUrl,
    installationId,
    publicIp,
    requestedLabelSource,
    buildManagedDomainAllocationMetadata(runtimeVersion),
  );

  return {
    managedDomain: buildManagedDomainInstallState(allocation, brokerUrl, acmeEmail),
    publicIngressIpv4: publicIngress.publicIngressIpv4,
    publicIngressIpv6: publicIngress.publicIngressIpv6,
  };
}

function readRequiredManagedDomainBrokerUrl(options: InstallCommandOptions): string {
  const brokerUrl: string | undefined = readInstallManagedDomainBrokerUrl(options);
  if (brokerUrl !== undefined) {
    return brokerUrl;
  }

  throw new Error('Managed domain install requires a broker URL.');
}

async function allocateManagedDomainForInstall(
  progress: InstallCommandProgress,
  brokerUrl: string,
  installationId: string,
  publicIp: string,
  requestedLabelSource: string,
  metadata: ManagedDomainAllocationMetadata,
): Promise<ManagedDomainAllocationResponse> {
  progress.report('Allocating managed install domain...');
  return await allocateInstallManagedDomain({
    brokerUrl,
    installationId,
    metadata,
    publicIp,
    requestedLabelSource,
  });
}

function buildManagedDomainAllocationMetadata(runtimeVersion: string): ManagedDomainAllocationMetadata {
  return {
    cliVersion: readCliVersion(),
    os: {
      arch: arch(),
      platform: platform(),
      release: release(),
    },
    runtimeVersion,
  };
}

function buildManagedDomainInstallState(
  allocation: ManagedDomainAllocationResponse,
  brokerUrl: string,
  acmeEmail: string,
): ManagedDomainInstallState {
  return {
    acmeEmail,
    baseDomain: allocation.baseDomain,
    brokerUrl,
    managedDomainBrokerToken: allocation.acmeDnsToken,
  };
}

async function readManagedDomainPublicIpAddress(progress: InstallCommandProgress): Promise<string> {
  progress.report('Detecting public IP address...');
  return await readPublicIpAddress();
}

function readManagedDomainPublicIngress(
  publicIp: string,
): Pick<ResolvedManagedDomainInstallState, 'publicIngressIpv4' | 'publicIngressIpv6'> {
  if (isIPv4(publicIp)) {
    return {
      publicIngressIpv4: publicIp,
      publicIngressIpv6: '',
    };
  }

  if (isIPv6(publicIp)) {
    return {
      publicIngressIpv4: '',
      publicIngressIpv6: publicIp,
    };
  }

  throw new Error(`Expected a valid public IP address, received: ${publicIp}.`);
}

function readRequestedManagedDomainLabelSource(organizationName: string, organizationSlug: string | undefined): string {
  if (organizationSlug !== undefined) {
    return truncateRequestedManagedDomainLabelSource(organizationSlug);
  }

  if (hasText(slugifyText(organizationName))) {
    return truncateRequestedManagedDomainLabelSource(organizationName);
  }

  throw new Error('Organization slug must contain at least one letter or digit.');
}

function truncateRequestedManagedDomainLabelSource(requestedLabelSource: string): string {
  return requestedLabelSource.slice(0, managedDomainRequestedLabelSourceMaxLength);
}

export function readResolvedInstallBaseDomain(
  options: InstallCommandOptions,
  managedDomain: ManagedDomainInstallState | undefined,
): string {
  if (managedDomain !== undefined) {
    return managedDomain.baseDomain;
  }

  const baseDomain: string | undefined = readInstallBaseDomain(options);
  if (baseDomain === undefined) {
    throw new Error('Install requires a managed domain, --base-domain, or --local-runtime.');
  }

  return baseDomain;
}
