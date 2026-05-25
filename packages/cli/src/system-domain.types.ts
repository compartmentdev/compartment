import type { DomainHostPlan, SystemDomainMutationResponse, SystemDomainStatusResponse } from '@compartment/contracts';
import type { InstallContext } from './install.types';
import type { ManagedDomainInstallState } from './managed-domain.types';

export interface SelfHostedSystemDomainInput {
  context?: InstallContext | undefined;
}

export interface SetSelfHostedSystemDomainInput extends SelfHostedSystemDomainInput {
  baseDomain: string;
  publicScheme: 'http' | 'https';
  tlsMode: 'custom-cert' | 'external';
}

export interface VersionedSelfHostedSystemDomainInput extends SelfHostedSystemDomainInput {
  expectedSetupVersion?: number | undefined;
}

export interface AttachSelfHostedSystemDomainCertificateInput extends VersionedSelfHostedSystemDomainInput {
  certificateFile: string;
  privateKeyFile: string;
}

export interface SystemDomainRuntimeCertificateInput {
  certificatePath: string;
  privateKeyPath: string;
}

export interface SystemDomainRuntimeApplyInput {
  certificate?: SystemDomainRuntimeCertificateInput | undefined;
  context?: InstallContext | undefined;
  hostPlan: DomainHostPlan;
  managedDomain?: ManagedDomainInstallState | undefined;
}

export type SelfHostedSystemDomainStatusResult = SystemDomainStatusResponse;

export type SelfHostedSystemDomainMutationResult = SystemDomainMutationResponse;
