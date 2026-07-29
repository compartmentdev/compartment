import type { CliIo } from '../../app.types';
import {
  promptNewPassword,
  promptRegisterEmail,
  promptRegisterOrganization,
  promptVisibleText,
} from '../../prompts/prompt';
import { readPromptLine } from '../../prompts/prompt-reader';
import type { InstallCommandOptions } from './install.command.types';
import type { KubernetesInstallInputValues } from './install.command.input.types';
import type { KubernetesInstallResourceInventory } from '../../services/kubernetes-install-inventory.service.types';
import type {
  KubernetesContextChoice,
  KubernetesInstallWizardInventory,
  KubernetesInstallWizardResult,
  KubernetesStorageClassChoice,
  ReadKubernetesInstallResourceInventory,
} from './install.command.kubernetes-wizard.types';
import { assertMutuallyExclusiveKubernetesInstallDomains } from './install.command.input';
import { normalizeInstallBaseDomain } from './install.command.validation';
import { assertManagedDomainOnboardingAvailable } from '../../services/managed-domain-reservation-token.service';

export async function resolveCanonicalKubernetesInstallWizard(
  io: CliIo,
  options: InstallCommandOptions,
  inventory: KubernetesInstallWizardInventory,
  readResources: ReadKubernetesInstallResourceInventory,
): Promise<KubernetesInstallWizardResult> {
  const context: KubernetesContextChoice = await selectContext(io, options.kubeContext, inventory.contexts);
  await confirmTarget(io, context);
  const resources: KubernetesInstallResourceInventory = await readResources(context.name);
  const ingressClass: string = await selectIngressClass(io, options.ingressClass, resources.ingressClasses);
  const storageClass: string = await selectStorageClass(io, options.storageClass, resources.storageClasses);
  return await finishWizard(io, options, context, ingressClass, storageClass);
}

async function finishWizard(
  io: CliIo,
  options: InstallCommandOptions,
  context: KubernetesContextChoice,
  ingressClass: string,
  storageClass: string,
): Promise<KubernetesInstallWizardResult> {
  const domain: Pick<InstallCommandOptions, 'baseDomain' | 'managedDomain'> = await resolveDomain(io, options);
  const email: string = await promptRegisterEmail(io, options.email);
  const organization: string = await promptRegisterOrganization(io, email, options.organization);
  const password: string = options.adminPassword ?? (await promptNewPassword(io));
  const input: Omit<KubernetesInstallInputValues, 'valuesPath'> = buildWizardInput(
    options,
    context.name,
    ingressClass,
    storageClass,
    domain,
    email,
    organization,
    password,
  );
  renderReview(io, input, context.apiServer);
  await confirmInstall(io);
  return { input };
}

function buildWizardInput(
  options: InstallCommandOptions,
  kubeContext: string,
  ingressClass: string,
  storageClass: string,
  domain: Pick<InstallCommandOptions, 'baseDomain' | 'managedDomain'>,
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

async function confirmTarget(io: CliIo, context: KubernetesContextChoice): Promise<void> {
  const answer: string = (await readPromptLine(io, `Use cluster "${context.name}" at ${context.apiServer}? [Y/n]: `))
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

async function resolveDomain(
  io: CliIo,
  options: InstallCommandOptions,
): Promise<Pick<InstallCommandOptions, 'baseDomain' | 'managedDomain'>> {
  assertMutuallyExclusiveKubernetesInstallDomains(options);
  if (options.managedDomain === true) {
    return resolveManagedDomain();
  }
  if (options.baseDomain !== undefined) {
    return { baseDomain: normalizeInstallBaseDomain(options.baseDomain) };
  }
  io.stderr('Domain:\n  1. Managed Compartment domain [default]\n  2. Operator-owned base domain\n');
  const mode: string = await promptVisibleText(io, 'Domain', '1');
  if (mode === '1') {
    return resolveManagedDomain();
  }
  if (mode !== '2') {
    throw new Error('Domain selection must be 1 or 2.');
  }
  return { baseDomain: normalizeInstallBaseDomain(await promptVisibleText(io, 'Base domain')) };
}

function resolveManagedDomain(): Pick<InstallCommandOptions, 'managedDomain'> {
  assertManagedDomainOnboardingAvailable();
  return { managedDomain: true };
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

function renderReview(io: CliIo, input: Omit<KubernetesInstallInputValues, 'valuesPath'>, apiServer: string): void {
  io.stderr(
    'Installation review:\n' +
      `  Context: ${input.kubeContext ?? ''} (${apiServer})\n` +
      `  Namespace: ${input.namespace ?? ''}\n` +
      `  Helm release: ${input.releaseName ?? ''}\n` +
      `  IngressClass: ${input.ingressClass ?? ''}\n` +
      `  StorageClass: ${input.storageClass ?? ''}\n` +
      `  Domain: ${input.managedDomain === true ? 'managed' : (input.baseDomain ?? '')}\n` +
      `  Owner: ${input.email ?? ''}\n` +
      `  Organization: ${input.organization ?? ''}\n`,
  );
}

async function confirmInstall(io: CliIo): Promise<void> {
  const answer: string = (await readPromptLine(io, 'Install Compartment? [y/N]: ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    throw new Error('Installation cancelled.');
  }
}
