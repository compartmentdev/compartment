import type { ManagedDomainReservationResponse } from '@compartment/contracts';
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
    tlsMode: 'broker-dns01',
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
    managedDomainAllocationId: '',
    managedDomainBrokerToken: '',
    ...publicIngress,
    publicProtocol: isReservedKubernetesInstallLocalhostDomain(input.baseDomain)
      ? foundationInstall.publicProtocol
      : 'https',
    tlsMode: foundationInstall.tlsMode,
  };
}

function requireCustomBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined) {
    return baseDomain;
  }
  throw new Error('Custom-domain install requires --base-domain.');
}
