import { buildPrivateRegistryHost, type ManagedDomainReservationResponse } from '@compartment/contracts';
import { isValidDnsHostname } from '@compartment/utils';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { resolveInstallPublicIngress } from './kubernetes-install-state-ingress.service';
import {
  buildManagedDomainAllocationMetadata,
  readExistingManagedAllocation,
  requireManagedBrokerUrl,
  requireManagedDomainRequestedLabelSource,
} from './kubernetes-install-managed-state.support';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { bindInstallManagedDomainTargets, reserveInstallManagedDomain } from './managed-domain.service';
import { readManagedDomainReservationToken } from './managed-domain-reservation-token.service';
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
      managedDomainAllocationId: state.managedDomainAllocationId,
      managedDomainBrokerUrl: state.brokerUrl,
      publicProtocol: state.publicProtocol,
      tlsMode: state.tlsMode,
    },
    installToken,
    state.managedDomainBrokerToken,
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
      managedDomainAllocationId: state.managedDomainAllocationId,
      managedDomainBrokerUrl: state.brokerUrl,
      publicProtocol: state.publicProtocol,
      tlsMode: state.tlsMode,
    },
    installToken,
    state.managedDomainBrokerToken,
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
  managedDomainBrokerToken: string,
  ingress?: KubernetesInstallIngressValues,
): KubernetesInstallSecretValues {
  return {
    ...(ingress === undefined ? {} : { ingress }),
    platform: platformValues,
    registry: { hostname: registry.registryHostname, issuerRef: registry.registryIssuerRef },
    secrets: { installToken, managedDomainBrokerToken },
  };
}

async function resolveManagedInstallState(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  publicIngress: KubernetesPublicIngress,
): Promise<KubernetesInstallState> {
  const existingAllocation: ManagedDomainReservationResponse | null = readExistingManagedAllocation(foundationInstall);
  const brokerUrl: string = requireManagedBrokerUrl(foundationInstall.brokerUrl);
  const allocation: ManagedDomainReservationResponse =
    existingAllocation ??
    (await runObservableInstallStep(
      input.progress,
      'Requesting managed domain',
      async (): Promise<ManagedDomainReservationResponse> =>
        await requestManagedDomainReservation(input, foundationInstall, brokerUrl),
    ));
  await bindObservableManagedDomainTargets(input, publicIngress, brokerUrl, allocation);
  return buildManagedInstallState(input, foundationInstall, publicIngress, brokerUrl, allocation);
}

async function bindObservableManagedDomainTargets(
  input: KubernetesInstallDeploymentInput,
  publicIngress: KubernetesPublicIngress,
  brokerUrl: string,
  allocation: ManagedDomainReservationResponse,
): Promise<void> {
  await runObservableInstallStep(input.progress, 'Binding managed-domain DNS targets', async (): Promise<void> => {
    await bindInstallManagedDomainTargets(
      {
        allocationId: allocation.allocationId,
        brokerUrl,
        scopedToken: allocation.scopedToken,
        targets: publicIngress.ingressTargets,
      },
      input.progress,
    );
  });
}

async function requestManagedDomainReservation(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  brokerUrl: string,
): Promise<ManagedDomainReservationResponse> {
  return await reserveInstallManagedDomain(
    {
      brokerUrl,
      installationId: foundationInstall.installationId,
      metadata: buildManagedDomainAllocationMetadata(),
      requestedLabelSource: requireManagedDomainRequestedLabelSource(input.managedDomainRequestedLabelSource),
      reservationToken: readManagedDomainReservationToken(),
    },
    input.progress,
  );
}

function buildManagedInstallState(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
  publicIngress: KubernetesPublicIngress,
  brokerUrl: string,
  allocation: ManagedDomainReservationResponse,
): KubernetesInstallState {
  return {
    acmeEmail: foundationInstall.acmeEmail !== '' ? foundationInstall.acmeEmail : input.acmeEmail,
    baseDomain: allocation.baseDomain,
    brokerUrl,
    domainMode: 'managed',
    installationId: foundationInstall.installationId,
    managedDomainAllocationId: allocation.allocationId,
    managedDomainBrokerToken: allocation.scopedToken,
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
    managedDomainAllocationId: '',
    managedDomainBrokerToken: '',
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
