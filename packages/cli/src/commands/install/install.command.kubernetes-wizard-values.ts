import type { KubernetesInstallWizardDomain } from './install.command.kubernetes-wizard.types';
import type { InstallWizardValues } from './install.command.types';

export function buildKubernetesInstallWizardValues(
  domain: KubernetesInstallWizardDomain,
  ingressClass: string,
  storageClass: string,
): InstallWizardValues {
  return {
    ingress: { className: ingressClass },
    ...(domain.input.publicProtocol === undefined ? {} : { platform: { publicProtocol: domain.input.publicProtocol } }),
    ...(domain.registry === undefined ? {} : { registry: domain.registry }),
    storage: { storageClass },
    ...(domain.tls === undefined ? {} : { tls: domain.tls }),
  };
}
