import { buildPrivateRegistryHost, type ManagedDomainAllocationResponse } from '@compartment/contracts';
import { isValidDnsHostname } from '@compartment/utils';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import {
  assertManagedDomainIngressEndpoint,
  resolveInstallPublicIngress,
} from './kubernetes-install-state-ingress.service';
import {
  buildManagedDomainAllocationMetadata,
  readExistingManagedAllocation,
  requireManagedBrokerUrl,
  requireManagedDomainRequestedLabelSource,
  type ExistingManagedDomainAllocation,
} from './kubernetes-install-managed-state.support';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { allocateInstallManagedDomain } from './managed-domain.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallIngressValues,
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
    managedDomainBrokerUrl: input.domainMode === 'managed' ? requireManagedBrokerUrl(input.brokerUrl) : '',
    ...(input.domainMode === 'managed' ? { publicProtocol: 'http', tlsMode: 'broker-dns01' } : {}),
  };
  return buildInstallValues(input, platformValues, installToken, '');
}

export function buildResolvedInstallValues(
  state: KubernetesInstallState,
  installToken: string,
): KubernetesInstallSecretValues {
  assertCompleteRegistryState(state);
  return buildInstallValues(
    state,
    {
      acmeEmail: state.acmeEmail,
      baseDomain: state.baseDomain,
      domainGeneration: resolvedDomainGeneration,
      domainMode: state.domainMode,
      installationId: state.installationId,
      managedDomainBrokerUrl: state.brokerUrl,
      publicProtocol: state.publicProtocol,
      tlsMode: state.tlsMode,
    },
    installToken,
    state.managedDomainAcmeDnsToken,
    buildInstallIngressValues(state),
  );
}

export function buildResumableFoundationValues(
  state: KubernetesInstallState,
  installToken: string,
): KubernetesInstallSecretValues {
  return buildInstallValues(
    state,
    {
      acmeEmail: state.acmeEmail,
      baseDomain: state.baseDomain,
      domainGeneration: initialDomainGeneration,
      domainMode: state.domainMode,
      installationId: state.installationId,
      managedDomainBrokerUrl: state.brokerUrl,
      publicProtocol: state.publicProtocol,
      tlsMode: state.tlsMode,
    },
    installToken,
    state.managedDomainAcmeDnsToken,
    buildInstallIngressValues(state),
  );
}

function buildInstallIngressValues(state: KubernetesInstallState): KubernetesInstallIngressValues {
  return {
    className: state.ingressClassName,
    endpoint: state.ingressEndpoint ?? { type: '', value: '' },
    targetsJson: JSON.stringify(state.ingressTargets),
  };
}

function buildInstallValues(
  registry: Pick<KubernetesInstallState, 'registryHostname' | 'registryIssuerRef'>,
  platformValues: KubernetesInstallPlatformValues,
  installToken: string,
  managedDomainAcmeDnsToken: string,
  ingress?: KubernetesInstallIngressValues,
): KubernetesInstallSecretValues {
  return {
    ...(ingress === undefined ? {} : { ingress }),
    platform: platformValues,
    registry: { hostname: registry.registryHostname, issuerRef: registry.registryIssuerRef },
    secrets: { installToken, managedDomainAcmeDnsToken },
  };
}

async function resolveManagedInstallState(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  publicIngress: KubernetesPublicIngress,
): Promise<KubernetesInstallState> {
  assertManagedDomainIngressEndpoint(publicIngress.ingressEndpoint);
  const existingAllocation: ExistingManagedDomainAllocation | null = readExistingManagedAllocation(foundationInstall);
  const brokerUrl: string = requireManagedBrokerUrl(foundationInstall.brokerUrl);
  const allocation: ExistingManagedDomainAllocation =
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
  const publicIp: string = publicIngress.ingressEndpoint?.value ?? '';
  return await allocateInstallManagedDomain(
    {
      brokerUrl,
      installationId: foundationInstall.installationId,
      metadata: buildManagedDomainAllocationMetadata(),
      publicIp,
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
  allocation: ExistingManagedDomainAllocation,
): KubernetesInstallState {
  return {
    acmeEmail: foundationInstall.acmeEmail !== '' ? foundationInstall.acmeEmail : input.acmeEmail,
    baseDomain: allocation.baseDomain,
    brokerUrl,
    domainMode: 'managed',
    installationId: foundationInstall.installationId,
    managedDomainAcmeDnsToken: allocation.acmeDnsToken,
    ...publicIngress,
    publicProtocol: 'https',
    registryHostname: resolveManagedRegistryHostname(input.registryHostname, allocation.baseDomain),
    registryIssuerRef: input.registryIssuerRef,
    tlsMode: 'broker-dns01',
  };
}

function resolveManagedRegistryHostname(configuredHostname: string, baseDomain: string): string {
  const hostname: string = configuredHostname !== '' ? configuredHostname : buildPrivateRegistryHost(baseDomain);
  if (!isValidDnsHostname(hostname)) {
    throw new Error(`The managed-domain allocation cannot form a valid private registry hostname: ${hostname}.`);
  }
  return hostname;
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
    managedDomainAcmeDnsToken: '',
    ...publicIngress,
    publicProtocol: isReservedKubernetesInstallLocalhostDomain(input.baseDomain)
      ? foundationInstall.publicProtocol
      : 'https',
    registryHostname: input.registryHostname,
    registryIssuerRef: input.registryIssuerRef,
    tlsMode: foundationInstall.tlsMode,
  };
}

function assertCompleteRegistryState(
  state: Pick<KubernetesInstallState, 'registryHostname' | 'registryIssuerRef'>,
): void {
  if (state.registryHostname === '') {
    throw new Error('Cannot start the full Helm installation without a resolved private registry hostname.');
  }
  if (state.registryIssuerRef.name === '') {
    throw new Error('Cannot start the full Helm installation without a private registry TLS issuer.');
  }
}

function requireCustomBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined) {
    return baseDomain;
  }
  throw new Error('Custom-domain install requires --base-domain.');
}
