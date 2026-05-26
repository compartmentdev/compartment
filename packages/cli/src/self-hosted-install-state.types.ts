import type { SelfHostedImageSource } from '@compartment/contracts';
import type { ManagedDomainInstallState } from './managed-domain.types';
import type { SelfHostedRuntimeImageRegistry } from './self-hosted-env.types';

export type { ManagedDomainInstallState } from './managed-domain.types';

export type SelfHostedInstallStateVersion = 1;

export interface SelfHostedInstallState {
  imageRegistry?: SelfHostedRuntimeImageRegistry | undefined;
  imageSource: SelfHostedImageSource;
  installationId: string;
  managedDomain?: ManagedDomainInstallState | undefined;
  stateVersion: SelfHostedInstallStateVersion;
}
