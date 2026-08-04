import type { CliIo } from '../../app.types';
import {
  promptNewPassword,
  promptRegisterEmail,
  promptRegisterOrganization,
  writeInstallOrganizationDetailsHeading,
} from '../../prompts/prompt';
import type { KubernetesInstallInputValues } from './install.command.input.types';
import type {
  KubernetesInstallIssuerChoice,
  KubernetesInstallResourceInventory,
} from '../../services/kubernetes-install-inventory.service.types';
import type {
  KubernetesContextChoice,
  KubernetesInstallWizardDomain,
  KubernetesInstallWizardInventory,
  KubernetesInstallWizardClusterSelection,
  KubernetesInstallWizardOwner,
  KubernetesInstallWizardResult,
  ReadKubernetesInstallResourceInventory,
  ReadKubernetesInstallRetainedState,
  InspectKubernetesInstallIssuer,
  ResolvedKubernetesInstallWizardReview,
} from './install.command.kubernetes-wizard.types';
import type { InstallCommandOptions } from './install.command.types';
import { confirmKubernetesInstall, renderKubernetesInstallReview } from './install.command.kubernetes-wizard-review';
import { resolveKubernetesInstallWizardDomainForSelection } from './install.command.kubernetes-wizard-domain';
import type { RetainedKubernetesInstallState } from '../../services/kubernetes-install.service.types';
import { buildKubernetesInstallWizardValues } from './install.command.kubernetes-wizard-values';
import {
  confirmInstallTarget,
  selectInstallContext,
  selectInstallIngressClass,
  selectInstallStorageClass,
} from './install.command.kubernetes-wizard-resources';

interface FinishKubernetesInstallWizardInput {
  context: KubernetesContextChoice;
  ingressClass: string;
  inspectIssuer: InspectKubernetesInstallIssuer;
  issuers: readonly KubernetesInstallIssuerChoice[];
  options: InstallCommandOptions;
  retainedState: RetainedKubernetesInstallState | null;
  storageClass: string;
}

interface PrepareFinishKubernetesInstallWizardInput {
  context: KubernetesContextChoice;
  inspectIssuer: InspectKubernetesInstallIssuer;
  options: InstallCommandOptions;
  readResources: ReadKubernetesInstallResourceInventory;
  readRetainedState: ReadKubernetesInstallRetainedState;
}

export async function resolveCanonicalKubernetesInstallWizard(
  io: CliIo,
  options: InstallCommandOptions,
  inventory: KubernetesInstallWizardInventory,
  readResources: ReadKubernetesInstallResourceInventory,
  inspectIssuer: InspectKubernetesInstallIssuer,
  readRetainedState: ReadKubernetesInstallRetainedState = async (): Promise<null> => await Promise.resolve(null),
): Promise<KubernetesInstallWizardResult> {
  const context: KubernetesContextChoice = await selectInstallContext(io, options.kubeContext, inventory.contexts);
  await confirmInstallTarget(io);
  return await finishWizard(
    io,
    await prepareFinishWizardInput(io, { context, inspectIssuer, options, readResources, readRetainedState }),
  );
}

async function prepareFinishWizardInput(
  io: CliIo,
  input: PrepareFinishKubernetesInstallWizardInput,
): Promise<FinishKubernetesInstallWizardInput> {
  const { context, inspectIssuer, options, readResources, readRetainedState } = input;
  const namespace: string = options.namespace ?? 'compartment';
  const resources: KubernetesInstallResourceInventory = await readResources(context.name, namespace);
  const retainedState: RetainedKubernetesInstallState | null = await readRetainedState(
    context.name,
    namespace,
    options.releaseName ?? 'compartment',
  );
  const ingressClass: string = await selectInstallIngressClass(io, options.ingressClass, resources.ingressClasses);
  const storageClass: string = await selectInstallStorageClass(io, options.storageClass, resources.storageClasses);
  return {
    context,
    ingressClass,
    inspectIssuer,
    issuers: resources.issuers,
    options,
    retainedState,
    storageClass,
  };
}

async function finishWizard(
  io: CliIo,
  input: FinishKubernetesInstallWizardInput,
): Promise<KubernetesInstallWizardResult> {
  const resolved: ResolvedKubernetesInstallWizardReview = await resolveWizardReview(
    io,
    input.options,
    input.context.name,
    input.ingressClass,
    input.storageClass,
    input.issuers,
    input.inspectIssuer,
    input.retainedState,
  );
  renderResolvedWizardReview(io, input, resolved);
  await confirmKubernetesInstall(io);
  return {
    input: resolved.input,
    values: buildKubernetesInstallWizardValues(resolved.domain, input.ingressClass, input.storageClass),
  };
}

function renderResolvedWizardReview(
  io: CliIo,
  input: FinishKubernetesInstallWizardInput,
  resolved: ResolvedKubernetesInstallWizardReview,
): void {
  renderKubernetesInstallReview(
    io,
    resolved.input,
    input.context.apiServer,
    resolved.domain.tlsReview,
    input.retainedState,
  );
}

async function resolveWizardReview(
  io: CliIo,
  options: InstallCommandOptions,
  kubeContext: string,
  ingressClass: string,
  storageClass: string,
  issuers: readonly KubernetesInstallIssuerChoice[],
  inspectIssuer: InspectKubernetesInstallIssuer,
  retainedState: RetainedKubernetesInstallState | null,
): Promise<ResolvedKubernetesInstallWizardReview> {
  const selection: KubernetesInstallWizardClusterSelection = { ingressClass, issuers, kubeContext, storageClass };
  const domain: KubernetesInstallWizardDomain = await resolveKubernetesInstallWizardDomainForSelection(
    io,
    options,
    selection,
    inspectIssuer,
    retainedState,
  );
  return {
    domain,
    input: buildResolvedWizardInput(options, selection, domain, await resolveWizardOwner(io, options)),
  };
}

function buildResolvedWizardInput(
  options: InstallCommandOptions,
  selection: KubernetesInstallWizardClusterSelection,
  domain: KubernetesInstallWizardDomain,
  owner: KubernetesInstallWizardOwner,
): Omit<KubernetesInstallInputValues, 'valuesPath'> {
  return buildWizardInput(
    options,
    selection.kubeContext,
    selection.ingressClass,
    selection.storageClass,
    domain.input,
    owner.email,
    owner.organization,
    owner.password,
  );
}

async function resolveWizardOwner(io: CliIo, options: InstallCommandOptions): Promise<KubernetesInstallWizardOwner> {
  writeInstallOrganizationDetailsHeading(io, options.email, options.organization);
  const email: string = await promptRegisterEmail(io, options.email);
  return {
    email,
    organization: await promptRegisterOrganization(io, email, options.organization),
    password: options.adminPassword ?? (await promptNewPassword(io)),
  };
}

function buildWizardInput(
  options: InstallCommandOptions,
  kubeContext: string,
  ingressClass: string,
  storageClass: string,
  domain: Pick<KubernetesInstallInputValues, 'baseDomain' | 'managedDomain' | 'publicProtocol'>,
  email: string,
  organization: string,
  password: string,
): Omit<KubernetesInstallInputValues, 'valuesPath'> {
  return {
    ...domain,
    email,
    ingressClass,
    ...(options.ingressEndpoint === undefined ? {} : { ingressEndpoint: options.ingressEndpoint }),
    kubeContext,
    namespace: options.namespace ?? 'compartment',
    organization,
    password,
    releaseName: options.releaseName ?? 'compartment',
    storageClass,
  };
}
