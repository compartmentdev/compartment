import type { CliIo } from '../../app.types';
import {
  promptNewPassword,
  promptRegisterEmail,
  promptRegisterOrganization,
  promptVisibleText,
} from '../../prompts/prompt';
import { readPromptLine } from '../../prompts/prompt-reader';
import type { KubernetesInstallInputValues } from './install.command.input.types';
import type { KubernetesInstallResourceInventory } from '../../services/kubernetes-install-inventory.service.types';
import type {
  KubernetesContextChoice,
  KubernetesInstallWizardDomain,
  KubernetesInstallWizardInventory,
  KubernetesInstallWizardClusterSelection,
  KubernetesInstallWizardOwner,
  KubernetesInstallWizardResult,
  KubernetesStorageClassChoice,
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

export async function resolveCanonicalKubernetesInstallWizard(
  io: CliIo,
  options: InstallCommandOptions,
  inventory: KubernetesInstallWizardInventory,
  readResources: ReadKubernetesInstallResourceInventory,
  inspectIssuer: InspectKubernetesInstallIssuer,
  readRetainedState: ReadKubernetesInstallRetainedState = async (): Promise<null> => await Promise.resolve(null),
): Promise<KubernetesInstallWizardResult> {
  const context: KubernetesContextChoice = await selectContext(io, options.kubeContext, inventory.contexts);
  await confirmTarget(io);
  const resources: KubernetesInstallResourceInventory = await readResources(context.name);
  const namespace: string = options.namespace ?? 'compartment';
  const releaseName: string = options.releaseName ?? 'compartment';
  const retainedState: RetainedKubernetesInstallState | null = await readRetainedState(
    context.name,
    namespace,
    releaseName,
  );
  const ingressClass: string = await selectIngressClass(io, options.ingressClass, resources.ingressClasses);
  const storageClass: string = await selectStorageClass(io, options.storageClass, resources.storageClasses);
  return await finishWizard(io, options, context, ingressClass, storageClass, inspectIssuer, retainedState);
}

async function finishWizard(
  io: CliIo,
  options: InstallCommandOptions,
  context: KubernetesContextChoice,
  ingressClass: string,
  storageClass: string,
  inspectIssuer: InspectKubernetesInstallIssuer,
  retainedState: RetainedKubernetesInstallState | null,
): Promise<KubernetesInstallWizardResult> {
  const resolved: ResolvedKubernetesInstallWizardReview = await resolveWizardReview(
    io,
    options,
    context.name,
    ingressClass,
    storageClass,
    inspectIssuer,
    retainedState,
  );
  renderKubernetesInstallReview(io, resolved.input, context.apiServer, resolved.domain.tlsReview, retainedState);
  await confirmKubernetesInstall(io);
  return {
    input: resolved.input,
    values: buildKubernetesInstallWizardValues(resolved.domain, ingressClass, storageClass),
  };
}

async function resolveWizardReview(
  io: CliIo,
  options: InstallCommandOptions,
  kubeContext: string,
  ingressClass: string,
  storageClass: string,
  inspectIssuer: InspectKubernetesInstallIssuer,
  retainedState: RetainedKubernetesInstallState | null,
): Promise<ResolvedKubernetesInstallWizardReview> {
  const selection: KubernetesInstallWizardClusterSelection = { ingressClass, kubeContext, storageClass };
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

async function selectIngressClass(
  io: CliIo,
  configured: string | undefined,
  choices: readonly string[],
): Promise<string> {
  return await selectNamedResource(io, 'IngressClass', configured, choices);
}

async function selectContext(
  io: CliIo,
  configured: string | undefined,
  contexts: readonly KubernetesContextChoice[],
): Promise<KubernetesContextChoice> {
  if (configured !== undefined) {
    const selected: KubernetesContextChoice | undefined = contexts.find(
      (context: KubernetesContextChoice): boolean => context.name === configured,
    );
    if (selected === undefined) {
      throw new Error(`Kubernetes context "${configured}" does not exist.`);
    }
    return selected;
  }
  return await selectChoice(
    io,
    'Kubernetes context',
    contexts,
    (context: KubernetesContextChoice): string => context.name,
  );
}

async function confirmTarget(io: CliIo): Promise<void> {
  const answer: string = (await readPromptLine(io, `Install Compartment into this cluster? [Y/n]: `))
    .trim()
    .toLowerCase();
  if (answer !== '' && answer !== 'y' && answer !== 'yes') {
    throw new Error('Installation cancelled.');
  }
}

async function selectStorageClass(
  io: CliIo,
  configured: string | undefined,
  choices: readonly KubernetesStorageClassChoice[],
): Promise<string> {
  if (configured !== undefined) {
    return await selectNamedResource(
      io,
      'StorageClass',
      configured,
      choices.map((choice: KubernetesStorageClassChoice): string => choice.name),
    );
  }
  const defaults: KubernetesStorageClassChoice[] = readDefaultStorageClasses(choices);
  if (defaults.length === 1) {
    return defaults[0]!.name;
  }
  return (await selectStorageChoice(io, choices)).name;
}

async function selectStorageChoice(
  io: CliIo,
  choices: readonly KubernetesStorageClassChoice[],
): Promise<KubernetesStorageClassChoice> {
  return await selectChoice(
    io,
    'StorageClass',
    choices,
    (choice: KubernetesStorageClassChoice): string => `${choice.name}${choice.default ? ' (default)' : ''}`,
  );
}

async function selectNamedResource(
  io: CliIo,
  label: string,
  configured: string | undefined,
  choices: readonly string[],
): Promise<string> {
  if (configured !== undefined) {
    if (!choices.includes(configured)) {
      throw new Error(`${label} "${configured}" does not exist.`);
    }
    return configured;
  }
  return choices.length === 1
    ? choices[0]!
    : await selectChoice(io, label, choices, (choice: string): string => choice);
}

function readDefaultStorageClasses(choices: readonly KubernetesStorageClassChoice[]): KubernetesStorageClassChoice[] {
  return choices.filter((choice: KubernetesStorageClassChoice): boolean => choice.default);
}

async function selectChoice<T>(
  io: CliIo,
  label: string,
  choices: readonly T[],
  render: (choice: T) => string,
): Promise<T> {
  if (choices.length === 0) {
    throw new Error(`No eligible ${label} values were found.`);
  }
  io.stderr(`${label}:\n`);
  choices.forEach((choice: T, index: number): void => io.stderr(`  ${String(index + 1)}. ${render(choice)}\n`));
  const answer: string = await promptVisibleText(io, label, '1');
  const index: number = Number(answer) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
    throw new Error(`${label} selection must be between 1 and ${String(choices.length)}.`);
  }
  return choices[index]!;
}
