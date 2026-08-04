import type { CliIo } from '../../app.types';
import { promptVisibleText } from '../../prompts/prompt';
import { readPromptLine } from '../../prompts/prompt-reader';
import type { KubernetesContextChoice, KubernetesStorageClassChoice } from './install.command.kubernetes-wizard.types';

export async function selectInstallContext(
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

export async function confirmInstallTarget(io: CliIo): Promise<void> {
  const answer: string = (await readPromptLine(io, 'Install Compartment into this cluster? [Y/n]: '))
    .trim()
    .toLowerCase();
  if (answer !== '' && answer !== 'y' && answer !== 'yes') {
    throw new Error('Installation cancelled.');
  }
}

export async function selectInstallIngressClass(
  io: CliIo,
  configured: string | undefined,
  choices: readonly string[],
): Promise<string> {
  return await selectNamedResource(io, 'IngressClass', configured, choices);
}

export async function selectInstallStorageClass(
  io: CliIo,
  configured: string | undefined,
  choices: readonly KubernetesStorageClassChoice[],
): Promise<string> {
  if (configured !== undefined) {
    return await selectConfiguredStorageClass(io, configured, choices);
  }
  const defaults: KubernetesStorageClassChoice[] = choices.filter(
    (choice: KubernetesStorageClassChoice): boolean => choice.default,
  );
  if (defaults.length === 1) {
    return defaults[0]!.name;
  }
  return (await selectStorageChoice(io, choices)).name;
}

async function selectConfiguredStorageClass(
  io: CliIo,
  configured: string,
  choices: readonly KubernetesStorageClassChoice[],
): Promise<string> {
  const names: string[] = choices.map((choice: KubernetesStorageClassChoice): string => choice.name);
  return await selectNamedResource(io, 'StorageClass', configured, names);
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
