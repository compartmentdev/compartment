import type { OutputFormat } from '../../output/output.types';
import type { KubernetesSystemStatusResponse } from '@compartment/contracts';
import type { ManagedVmSystemStatus } from '../../services/managed-vm-lifecycle.service.types';

export interface KubernetesOperatorCommandOptions {
  chart?: string | undefined;
  kubeContext?: string | undefined;
  namespace?: string | undefined;
  output: OutputFormat;
  releaseName?: string | undefined;
  values?: string | undefined;
}

export interface SystemDomainSetCommandOptions extends KubernetesOperatorCommandOptions {
  baseDomain: string;
}

export interface SystemDomainVersionedCommandOptions extends KubernetesOperatorCommandOptions {
  expectedVersion?: string | undefined;
}

export interface IssuePasswordResetCommandOptions extends KubernetesOperatorCommandOptions {
  email: string;
}

export interface KubernetesSystemUpdateCommandOptions extends KubernetesOperatorCommandOptions {
  values?: string | undefined;
  version?: string | undefined;
}

export interface ManagedVmDiagnoseCommandOptions {
  output: OutputFormat;
  path?: string | undefined;
}

export interface ManagedVmCompositeSystemStatus {
  host: ManagedVmSystemStatus;
  platform: KubernetesSystemStatusResponse;
}

export interface ResolvedSystemDomainVersionedCommand {
  expectedSetupVersion?: number | undefined;
}
