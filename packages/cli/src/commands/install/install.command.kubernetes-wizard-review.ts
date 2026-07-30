import type { CliIo } from '../../app.types';
import { readPromptLine } from '../../prompts/prompt-reader';
import type { KubernetesInstallInputValues } from './install.command.input.types';

export function renderKubernetesInstallReview(
  io: CliIo,
  input: Omit<KubernetesInstallInputValues, 'valuesPath'>,
  apiServer: string,
  tlsReview: string,
): void {
  io.stderr(
    'Installation review:\n' +
      `  Context: ${input.kubeContext ?? ''} (${apiServer})\n` +
      `  Namespace: ${input.namespace ?? ''}\n` +
      `  Helm release: ${input.releaseName ?? ''}\n` +
      `  IngressClass: ${input.ingressClass ?? ''}\n` +
      `  StorageClass: ${input.storageClass ?? ''}\n` +
      `  Domain: ${input.managedDomain === true ? 'managed' : (input.baseDomain ?? '')}\n` +
      `  TLS: ${tlsReview}\n` +
      `  Owner: ${input.email ?? ''}\n` +
      `  Organization: ${input.organization ?? ''}\n`,
  );
}

export async function confirmKubernetesInstall(io: CliIo): Promise<void> {
  const answer: string = (await readPromptLine(io, 'Install Compartment? [y/N]: ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    throw new Error('Installation cancelled.');
  }
}
