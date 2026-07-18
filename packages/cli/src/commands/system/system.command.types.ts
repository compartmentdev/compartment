import type { OutputFormat } from '../../output/output.types';
import type { KubernetesOperatorTarget } from '../../services/kubernetes-operator.service.types';

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
  tls?: string | undefined;
}

export interface SystemDomainVersionedCommandOptions extends KubernetesOperatorCommandOptions {
  expectedVersion?: string | undefined;
}

export interface SystemDomainAttachCertificateCommandOptions extends SystemDomainVersionedCommandOptions {
  certFile: string;
  keyFile: string;
}

export interface IssuePasswordResetCommandOptions extends KubernetesOperatorCommandOptions {
  email: string;
}

export interface KubernetesSystemUpdateCommandOptions extends KubernetesOperatorCommandOptions {
  version?: string | undefined;
}

export interface ResolvedSystemDomainVersionedCommand {
  expectedSetupVersion?: number | undefined;
  target: KubernetesOperatorTarget;
}
