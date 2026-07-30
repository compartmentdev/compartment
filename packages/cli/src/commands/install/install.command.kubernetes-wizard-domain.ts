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
  return await resolveKubernetesInstallWizardDomain(
    io,
    options,
    selection.kubeContext,
    selection.ingressClass,
    selection.storageClass,
    inspectIssuer,
  );
}

async function resolveKubernetesInstallWizardDomain(
  io: CliIo,
  options: InstallCommandOptions,
  kubeContext: string,
  ingressClass: string,
  storageClass: string,
  inspectIssuer: InspectKubernetesInstallIssuer,
): Promise<KubernetesInstallWizardDomain> {
  assertMutuallyExclusiveKubernetesInstallDomains(options);
  if (options.managedDomain === true) {
    return resolveManagedDomain();
  }
  if (options.baseDomain !== undefined) {
    return await resolveOperatorDomainTls(
      io,
      buildTlsPromptInput(options.baseDomain, options, kubeContext, ingressClass, storageClass, inspectIssuer),
    );
  }
  return await promptDomainChoice(io, options, kubeContext, ingressClass, storageClass, inspectIssuer);
}

async function promptDomainChoice(
  io: CliIo,
  options: InstallCommandOptions,
  kubeContext: string,
  ingressClass: string,
  storageClass: string,
  inspectIssuer: InspectKubernetesInstallIssuer,
): Promise<KubernetesInstallWizardDomain> {
  io.stderr('Domain:\n  1. Managed Compartment domain [default]\n  2. Operator-owned base domain\n');
  const mode: string = await promptVisibleText(io, 'Domain', '1');
  if (mode === '1') {
    return resolveManagedDomain();
  }
  if (mode === '2') {
    const baseDomain: string = await promptVisibleText(io, 'Base domain');
    return await resolveOperatorDomainTls(
      io,
      buildTlsPromptInput(baseDomain, options, kubeContext, ingressClass, storageClass, inspectIssuer),
    );
  }
  throw new Error('Domain selection must be 1 or 2.');
}

function buildTlsPromptInput(
  baseDomain: string,
  options: InstallCommandOptions,
  kubeContext: string,
  ingressClass: string,
  storageClass: string,
  inspectIssuer: InspectKubernetesInstallIssuer,
): OperatorDomainTlsPromptInput {
  return {
    baseDomain: normalizeInstallBaseDomain(baseDomain),
    ingressClass,
    kubeContext,
    namespace: options.namespace ?? 'compartment',
    releaseName: options.releaseName ?? 'compartment',
    storageClass,
    inspectIssuer,
  };
}

function resolveManagedDomain(): KubernetesInstallWizardDomain {
  return { input: { managedDomain: true }, tlsReview: 'managed by Compartment' };
}
