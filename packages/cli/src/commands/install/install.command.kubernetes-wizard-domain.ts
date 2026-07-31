import { isIP } from 'node:net';
import type { CliIo } from '../../app.types';
import { promptVisibleText } from '../../prompts/prompt';
import { assertMutuallyExclusiveKubernetesInstallDomains } from './install.command.input';
import { resolveOperatorDomainTls, type OperatorDomainTlsPromptInput } from './install.command.kubernetes-wizard-tls';
import type {
  InspectKubernetesInstallIssuer,
  KubernetesInstallWizardClusterSelection,
  KubernetesInstallWizardDomain,
} from './install.command.kubernetes-wizard.types';
import type { InstallCommandOptions } from './install.command.types';
import { normalizeInstallBaseDomain } from './install.command.validation';

export async function resolveKubernetesInstallWizardDomainForSelection(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
): Promise<KubernetesInstallWizardDomain> {
  return await resolveKubernetesInstallWizardDomain(io, options, selection, inspectIssuer);
}

async function resolveKubernetesInstallWizardDomain(
  io: CliIo,
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  inspectIssuer: InspectKubernetesInstallIssuer,
): Promise<KubernetesInstallWizardDomain> {
  assertMutuallyExclusiveKubernetesInstallDomains(options);
  const managedDomainUnavailable: boolean =
    options.ingressEndpoint !== undefined && isIP(options.ingressEndpoint) === 0;
  if (options.managedDomain === true) {
    if (managedDomainUnavailable) {
      throw hostnameManagedDomainError();
    }
    return resolveManagedDomain();
  }
  if (options.baseDomain !== undefined) {
    return await resolveOperatorDomainTls(
      io,
      buildTlsPromptInput(options.baseDomain, options, selection, inspectIssuer),
    );
  }
  return await promptDomainChoice(io, options, selection, inspectIssuer, managedDomainUnavailable);
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
    const baseDomain: string = await promptVisibleText(io, 'Operator-owned base domain');
    return await resolveOperatorDomainTls(io, buildTlsPromptInput(baseDomain, options, selection, inspectIssuer));
  }
  io.stderr('Domain:\n  1. Managed Compartment domain [default]\n  2. Operator-owned base domain\n');
  const mode: string = await promptVisibleText(io, 'Domain', '1');
  if (mode === '1') {
    return resolveManagedDomain();
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
  const baseDomain: string = await promptVisibleText(io, 'Base domain');
  return await resolveOperatorDomainTls(io, buildTlsPromptInput(baseDomain, options, selection, inspectIssuer));
}

function hostnameManagedDomainError(): Error {
  return new Error(
    'Managed domains are unavailable for a hostname Ingress endpoint because the broker can publish only A/AAAA records to an IP address. Use your own domain with --base-domain instead.',
  );
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

function resolveManagedDomain(): KubernetesInstallWizardDomain {
  return { input: { managedDomain: true }, tlsReview: 'managed by Compartment' };
}
