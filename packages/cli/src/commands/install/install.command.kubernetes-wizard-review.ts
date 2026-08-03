import type { CliIo } from '../../app.types';
import { readPromptLine } from '../../prompts/prompt-reader';
import type { KubernetesInstallInputValues } from './install.command.input.types';
import type { RetainedKubernetesInstallState } from '../../services/kubernetes-install.service.types';

export function renderKubernetesInstallReview(
  io: CliIo,
  input: Omit<KubernetesInstallInputValues, 'valuesPath'>,
  apiServer: string,
  tlsReview: string,
  retainedState: RetainedKubernetesInstallState | null = null,
): void {
  const domainReview: string = buildDomainReview(input, retainedState);
  io.stderr(
    'Installation review:\n' +
      `  Context: ${input.kubeContext ?? ''} (${apiServer})\n` +
      `  Namespace: ${input.namespace ?? ''}\n` +
      `  Helm release: ${input.releaseName ?? ''}\n` +
      `  IngressClass: ${input.ingressClass ?? ''}\n` +
      `  StorageClass: ${input.storageClass ?? ''}\n` +
      `  Domain: ${domainReview}\n` +
      `  TLS: ${tlsReview}\n` +
      `  Owner: ${input.email ?? ''}\n` +
      `  Organization: ${input.organization ?? ''}\n`,
  );
}

function buildDomainReview(
  input: Omit<KubernetesInstallInputValues, 'valuesPath'>,
  retainedState: RetainedKubernetesInstallState | null,
): string {
  if (retainedState !== null) {
    if (retainedState.domainMode === 'managed' && retainedState.baseDomain === '') {
      return 'not yet allocated (retained managed domain)';
    }
    return `${retainedState.baseDomain} (retained ${retainedState.domainMode} domain)`;
  }
  return input.managedDomain === true ? 'managed (allocated during installation)' : (input.baseDomain ?? '');
}

export async function confirmKubernetesInstall(io: CliIo): Promise<void> {
  const answer: string = (await readPromptLine(io, 'Install Compartment? [y/N]: ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    throw new Error('Installation cancelled.');
  }
}
