import { isIP } from 'node:net';
import type { CliIo } from '../../app.types';
import { promptRequiredVisibleText, promptVisibleText } from '../../prompts/prompt';
import { assertMutuallyExclusiveKubernetesInstallDomains } from './install.command.input';
import {
  resolveOperatorDomainTls,
  resolveRegistryIpTls,
  type OperatorDomainTlsPromptInput,
} from './install.command.kubernetes-wizard-tls';
import type {
  InspectKubernetesInstallIssuer,
  KubernetesInstallWizardClusterSelection,
  KubernetesInstallWizardDomain,
} from './install.command.kubernetes-wizard.types';
import type { InstallCommandOptions, InstallWizardRegistryValues } from './install.command.types';
import { normalizeInstallBaseDomain } from './install.command.validation';
import type { RetainedKubernetesInstallState } from '../../services/kubernetes-install.service.types';

export async function resolveKubernetesInstallWizardDomainForSelection(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
  retainedState: RetainedKubernetesInstallState | null = null,
): Promise<KubernetesInstallWizardDomain> {
  return await resolveKubernetesInstallWizardDomain(io, options, selection, inspectIssuer, retainedState);
}

async function resolveKubernetesInstallWizardDomain(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
  retainedState: RetainedKubernetesInstallState | null,
): Promise<KubernetesInstallWizardDomain> {
  assertMutuallyExclusiveKubernetesInstallDomains(options);
  const managedDomainUnavailable: boolean =
    options.ingressEndpoint !== undefined && isIP(options.ingressEndpoint) === 0;
  if (retainedState !== null) {
    return await resolveRetainedDomain(io, options, selection, inspectIssuer, retainedState, managedDomainUnavailable);
  }
  return await resolveFreshDomain(io, options, selection, inspectIssuer, managedDomainUnavailable);
}

async function resolveFreshDomain(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
  managedDomainUnavailable: boolean,
): Promise<KubernetesInstallWizardDomain> {
  if (options.managedDomain === true) {
    if (managedDomainUnavailable) {
      throw hostnameManagedDomainError();
    }
    return await resolveManagedDomain(io, options, selection, inspectIssuer);
  }
  if (options.baseDomain !== undefined) {
    return await resolveOperatorDomainTls(
      io,
      buildTlsPromptInput(options.baseDomain, options, selection, inspectIssuer),
    );
  }
  return await promptDomainChoice(io, options, selection, inspectIssuer, managedDomainUnavailable);
}

async function resolveRetainedDomain(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
  retainedState: RetainedKubernetesInstallState,
  managedDomainUnavailable: boolean,
): Promise<KubernetesInstallWizardDomain> {
  assertMatchingRetainedDomainOption(options, retainedState);
  if (retainedState.domainMode === 'managed') {
    if (managedDomainUnavailable) {
      throw hostnameManagedDomainError();
    }
    return await resolveManagedDomain(io, options, selection, inspectIssuer);
  }
  return await resolveOperatorDomainTls(
    io,
    buildTlsPromptInput(retainedState.baseDomain, options, selection, inspectIssuer),
  );
}

function assertMatchingRetainedDomainOption(
  options: InstallCommandOptions,
  retainedState: RetainedKubernetesInstallState,
): void {
  if (options.managedDomain === true && retainedState.domainMode !== 'managed') {
    throw new Error(`This installation uses the retained operator-owned domain ${retainedState.baseDomain}.`);
  }
  if (options.baseDomain === undefined) {
    return;
  }
  const baseDomain: string = normalizeInstallBaseDomain(options.baseDomain);
  if (retainedState.domainMode !== 'custom' || baseDomain !== retainedState.baseDomain) {
    throw new Error(
      `This installation uses the retained ${retainedState.domainMode} domain ${retainedState.baseDomain}.`,
    );
  }
}

async function promptDomainChoice(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
  managedDomainUnavailable: boolean,
): Promise<KubernetesInstallWizardDomain> {
  if (managedDomainUnavailable) {
    io.stderr(
      'Domain:\n  Managed Compartment domains are unavailable because this Ingress endpoint is a hostname; the broker publishes only A/AAAA records to IP addresses.\n',
    );
    const baseDomain: string = await promptRequiredVisibleText(io, 'Operator-owned base domain');
    return await resolveOperatorDomainTls(io, buildTlsPromptInput(baseDomain, options, selection, inspectIssuer));
  }
  io.stderr('Domain:\n  1. Managed Compartment domain [default]\n  2. Operator-owned base domain\n');
  const mode: string = await promptVisibleText(io, 'Domain', '1');
  if (mode === '1') {
    return await resolveManagedDomain(io, options, selection, inspectIssuer);
  }
  if (mode === '2') {
    return await promptOperatorDomain(io, options, selection, inspectIssuer);
  }
  throw new Error('Domain selection must be 1 or 2.');
}

async function promptOperatorDomain(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
): Promise<KubernetesInstallWizardDomain> {
  const baseDomain: string = await promptRequiredVisibleText(io, 'Base domain');
  return await resolveOperatorDomainTls(io, buildTlsPromptInput(baseDomain, options, selection, inspectIssuer));
}

function hostnameManagedDomainError(): Error {
  return new Error(
    'Managed domains are unavailable for a hostname Ingress endpoint because the broker can publish only A/AAAA records to an IP address. Use your own domain with --base-domain instead.',
  );
}

async function resolveManagedDomain(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
): Promise<KubernetesInstallWizardDomain> {
  const registry: InstallWizardRegistryValues = await resolveRegistryIpTls(
    io,
    buildTlsPromptInput('managed.invalid', options, selection, inspectIssuer),
  );
  return {
    input: { managedDomain: true },
    registry,
    tlsReview: `managed platform; registry ${registry.issuerRef.kind}/${registry.issuerRef.name}`,
  };
}

function buildTlsPromptInput(
  baseDomain: string,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
): OperatorDomainTlsPromptInput {
  return {
    baseDomain: normalizeInstallBaseDomain(baseDomain),
    ingressClass: selection.ingressClass,
    kubeContext: selection.kubeContext,
    namespace: options.namespace ?? 'compartment',
    releaseName: options.releaseName ?? 'compartment',
    storageClass: selection.storageClass,
    inspectIssuer,
  };
}
