import type { SelfHostedImageSource } from '@compartment/contracts';
import type { ManagedDomainInstallState } from './managed-domain.types';

export type { ManagedDomainInstallState } from './managed-domain.types';

export type SelfHostedInstallStateVersion = 1;

export interface SelfHostedInstallState {
  imageSource: SelfHostedImageSource;
  installationId: string;
  managedDomain?: ManagedDomainInstallState | undefined;
  stateVersion: SelfHostedInstallStateVersion;
}
