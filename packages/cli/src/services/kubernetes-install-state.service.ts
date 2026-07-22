import { arch, platform, release } from 'node:os';
import type {
  ManagedDomainAllocationMetadata,
  ManagedDomainAllocationOsMetadata,
  ManagedDomainAllocationResponse,
} from '@compartment/contracts';
import { readCliVersion } from '../cli-build-info';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { resolveKubernetesPublicIngress } from './kubernetes-install-ingress.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { allocateInstallManagedDomain } from './managed-domain.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallPlatformValues,
  KubernetesInstallSecretValues,
  KubernetesInstallState,
  KubernetesPublicIngress,
} from './kubernetes-install.service.types';

const initialDomainGeneration: number = 0;
const resolvedDomainGeneration: number = 1;

export async function resolveKubernetesInstallState(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
): Promise<KubernetesInstallState> {
  const publicIngress: KubernetesPublicIngress = await resolveInstallPublicIngress(input, foundationInstall);
  if (input.domainMode === 'managed') {
    return await resolveManagedInstallState(input, foundationInstall, publicIngress);
  }
  return resolveCustomInstallState(input, foundationInstall, publicIngress);
}

export function buildInitialInstallValues(
  input: KubernetesInstallDeploymentInput,
  installToken: string,
  installationId: string,
): KubernetesInstallSecretValues {
  const platformValues: KubernetesInstallPlatformValues = {
    acmeEmail: input.acmeEmail,
    baseDomain: input.baseDomain ?? '',
    domainGeneration: initialDomainGeneration,
    domainMode: input.domainMode,
    installationId,
    managedDomainBrokerUrl: input.brokerUrl ?? '',
    ...(input.domainMode === 'managed' ? { publicProtocol: 'https', tlsMode: 'managed' } : {}),
  };
  return buildInstallValues(platformValues, installToken, '');
}

export function buildResolvedInstallValues(
  state: KubernetesInstallState,
  installToken: string,
): KubernetesInstallSecretValues {
  return buildInstallValues(
    {
      acmeEmail: state.acmeEmail,
      baseDomain: state.baseDomain,
      domainGeneration: resolvedDomainGeneration,
      domainMode: state.domainMode,
      installationId: state.installationId,
      managedDomainBrokerUrl: state.brokerUrl,
      publicIngressIpv4: state.publicIngressIpv4,
      publicIngressIpv6: state.publicIngressIpv6,
      publicProtocol: state.publicProtocol,
      tlsMode: state.tlsMode,
    },
    installToken,
    state.managedDomainBrokerToken,
  );
}

export function buildResumableFoundationValues(
  state: KubernetesInstallState,
  installToken: string,
): KubernetesInstallSecretValues {
  return buildInstallValues(
    {
      acmeEmail: state.acmeEmail,
      baseDomain: state.baseDomain,
      domainGeneration: initialDomainGeneration,
      domainMode: state.domainMode,
      installationId: state.installationId,
      managedDomainBrokerUrl: state.brokerUrl,
      ...(state.publicIngressIpv4 === '' ? {} : { publicIngressIpv4: state.publicIngressIpv4 }),
      ...(state.publicIngressIpv6 === '' ? {} : { publicIngressIpv6: state.publicIngressIpv6 }),
      publicProtocol: state.publicProtocol,
      tlsMode: state.tlsMode,
    },
    installToken,
    state.managedDomainBrokerToken,
  );
}

function buildInstallValues(
  platformValues: KubernetesInstallPlatformValues,
  installToken: string,
  managedDomainBrokerToken: string,
): KubernetesInstallSecretValues {
  return {
    platform: platformValues,
    secrets: { installToken, managedDomainBrokerToken },
  };
}

async function resolveManagedInstallState(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  publicIngress: KubernetesPublicIngress,
): Promise<KubernetesInstallState> {
  const existingAllocation: ManagedDomainAllocationResponse | null = readExistingManagedAllocation(foundationInstall);
  const brokerUrl: string = requireManagedBrokerUrl(foundationInstall.brokerUrl);
  const allocation: ManagedDomainAllocationResponse =
    existingAllocation ??
    (await runObservableInstallStep(
      input.progress,
      'Requesting managed domain',
      async (): Promise<ManagedDomainAllocationResponse> =>
        await requestManagedDomainAllocation(input, foundationInstall, publicIngress, brokerUrl),
    ));
  return buildManagedInstallState(input, foundationInstall, publicIngress, brokerUrl, allocation);
}

async function requestManagedDomainAllocation(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  publicIngress: KubernetesPublicIngress,
  brokerUrl: string,
): Promise<ManagedDomainAllocationResponse> {
  return await allocateInstallManagedDomain(
    {
      brokerUrl,
      installationId: foundationInstall.installationId,
      metadata: buildManagedDomainAllocationMetadata(),
      publicIp:
        publicIngress.publicIngressIpv4 !== '' ? publicIngress.publicIngressIpv4 : publicIngress.publicIngressIpv6,
      requestedLabelSource: requireManagedDomainRequestedLabelSource(input.managedDomainRequestedLabelSource),
    },
    input.progress,
  );
}

function buildManagedInstallState(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  publicIngress: KubernetesPublicIngress,
  brokerUrl: string,
  allocation: ManagedDomainAllocationResponse,
): KubernetesInstallState {
  return {
    acmeEmail: foundationInstall.acmeEmail !== '' ? foundationInstall.acmeEmail : input.acmeEmail,
    baseDomain: allocation.baseDomain,
    brokerUrl,
    domainMode: 'managed',
    installationId: foundationInstall.installationId,
    managedDomainBrokerToken: allocation.acmeDnsToken,
    ...publicIngress,
    publicProtocol: 'https',
    tlsMode: 'managed',
  };
}

function resolveCustomInstallState(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  publicIngress: KubernetesPublicIngress,
): KubernetesInstallState {
  return {
    acmeEmail: foundationInstall.acmeEmail !== '' ? foundationInstall.acmeEmail : input.acmeEmail,
    baseDomain: requireCustomBaseDomain(input.baseDomain),
    brokerUrl: '',
    domainMode: 'custom',
    installationId: foundationInstall.installationId,
    managedDomainBrokerToken: '',
    ...publicIngress,
    publicProtocol: isReservedKubernetesInstallLocalhostDomain(input.baseDomain)
      ? foundationInstall.publicProtocol
      : 'https',
    tlsMode: foundationInstall.tlsMode,
  };
}

async function resolveInstallPublicIngress(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
): Promise<KubernetesPublicIngress> {
  if (input.domainMode === 'custom' && isReservedKubernetesInstallLocalhostDomain(input.baseDomain)) {
    return {
      publicIngressIpv4: foundationInstall.publicIngressIpv4,
      publicIngressIpv6: foundationInstall.publicIngressIpv6,
    };
  }
  return await runObservableInstallStep(
    input.progress,
    'Waiting for public LoadBalancer address',
    async (): Promise<KubernetesPublicIngress> => await discoverKubernetesPublicIngress(input, foundationInstall),
    readPublicIngressAddress,
  );
}

async function discoverKubernetesPublicIngress(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
): Promise<KubernetesPublicIngress> {
  return await resolveKubernetesPublicIngress({
    kubeconfigPath: input.kubeconfigPath,
    kubeContext: input.kubeContext,
    namespace: input.namespace,
    publicIngressIpv4: foundationInstall.publicIngressIpv4,
    publicIngressIpv6: foundationInstall.publicIngressIpv6,
    releaseName: input.releaseName,
  });
}

function readPublicIngressAddress(ingress: KubernetesPublicIngress): string | undefined {
  if (ingress.publicIngressIpv4 !== '') {
    return ingress.publicIngressIpv4;
  }
  return ingress.publicIngressIpv6 === '' ? undefined : ingress.publicIngressIpv6;
}

function readExistingManagedAllocation(
  existingInstall: ExistingKubernetesInstall,
): ManagedDomainAllocationResponse | null {
  if (existingInstall.baseDomain === '' && existingInstall.managedDomainBrokerToken === '') {
    return null;
  }
  if (existingInstall.baseDomain !== '' && existingInstall.managedDomainBrokerToken !== '') {
    return {
      acmeDnsToken: existingInstall.managedDomainBrokerToken,
      baseDomain: existingInstall.baseDomain,
    };
  }
  throw new Error('The existing managed-domain install has incomplete allocation state.');
}

function requireManagedBrokerUrl(brokerUrl: string | undefined): string {
  if (brokerUrl !== undefined) {
    return brokerUrl;
  }
  throw new Error('Managed domain install requires a broker URL.');
}

function requireManagedDomainRequestedLabelSource(value: string | undefined): string {
  if (value !== undefined && value !== '') {
    return value;
  }
  throw new Error('Managed domain install requires an organization label source.');
}

function requireCustomBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined) {
    return baseDomain;
  }
  throw new Error('Custom-domain install requires --base-domain.');
}

function buildManagedDomainAllocationMetadata(): ManagedDomainAllocationMetadata {
  const cliVersion: string = readCliVersion();
  const os: ManagedDomainAllocationOsMetadata = { arch: arch(), platform: platform(), release: release() };
  return {
    cliVersion,
    os,
    runtimeVersion: cliVersion,
  };
}
