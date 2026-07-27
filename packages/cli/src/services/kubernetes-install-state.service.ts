import type { ManagedDomainAllocationResponse } from '@compartment/contracts';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { readManagedDomainPublicIp, resolveKubernetesPublicIngress } from './kubernetes-install-ingress.service';
import {
  buildManagedDomainAllocationMetadata,
  readExistingManagedAllocation,
  requireManagedBrokerUrl,
  requireManagedDomainRequestedLabelSource,
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
    managedDomainBrokerUrl: input.brokerUrl ?? '',
    ...(input.domainMode === 'managed' ? { publicProtocol: 'http', tlsMode: 'managed' } : {}),
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
    {
      className: state.ingressClassName,
      endpoint: state.ingressEndpoint ?? { type: '', value: '' },
    },
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
    {
      className: state.ingressClassName,
      endpoint: state.ingressEndpoint ?? { type: '', value: '' },
    },
  );
}

function buildInstallValues(
  platformValues: KubernetesInstallPlatformValues,
  installToken: string,
  managedDomainBrokerToken: string,
  ingress?: KubernetesInstallIngressValues,
): KubernetesInstallSecretValues {
  return {
    ...(ingress === undefined ? {} : { ingress }),
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
      publicIp: readManagedDomainPublicIp(publicIngress),
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
    publicProtocol: 'http',
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
      ingressClassName: foundationInstall.ingressClassName,
      ingressEndpoint: foundationInstall.ingressEndpoint,
      publicIngressIpv4: foundationInstall.publicIngressIpv4,
      publicIngressIpv6: foundationInstall.publicIngressIpv6,
    };
  }
  return await runObservableInstallStep(
    input.progress,
    'Waiting for Ingress endpoint',
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
    configuredEndpoint: foundationInstall.ingressEndpoint,
    ingressClassName: foundationInstall.ingressClassName,
    releaseName: input.releaseName,
  });
}

function readPublicIngressAddress(ingress: KubernetesPublicIngress): string | undefined {
  return ingress.ingressEndpoint?.value;
}

function requireCustomBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined) {
    return baseDomain;
  }
  throw new Error('Custom-domain install requires --base-domain.');
}
