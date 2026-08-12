import type { KubernetesInstallInputValues } from './install.command.input.types';
import type { InstallCommandOptions } from './install.command.types';

export function readNonInteractiveInstallValues(
  options: InstallCommandOptions,
  password: string | undefined,
): Omit<KubernetesInstallInputValues, 'valuesPath'> {
  return {
    ...(options.baseDomain === undefined ? {} : { baseDomain: options.baseDomain }),
    ...(options.email === undefined ? {} : { email: options.email }),
    ...(options.ingressClass === undefined ? {} : { ingressClass: options.ingressClass }),
    ...(options.ingressEndpoint === undefined ? {} : { ingressEndpoint: options.ingressEndpoint }),
    ...(options.kubeContext === undefined ? {} : { kubeContext: options.kubeContext }),
    ...(options.managedDomain === undefined ? {} : { managedDomain: options.managedDomain }),
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.organization === undefined ? {} : { organization: options.organization }),
    ...(password === undefined ? {} : { password }),
    ...(options.releaseName === undefined ? {} : { releaseName: options.releaseName }),
    ...(options.storageClass === undefined ? {} : { storageClass: options.storageClass }),
  };
}
