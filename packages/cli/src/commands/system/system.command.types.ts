import type { OutputFormat } from '../../output/output.types';

interface SystemOutputCommandOptions {
  output: OutputFormat;
}

export interface IssuePasswordResetCommandOptions extends SystemOutputCommandOptions {
  email: string;
}

export interface SystemDomainAttachCertificateCommandOptions extends SystemDomainVersionedCommandOptions {
  certFile: string;
  keyFile: string;
}

export interface SystemDomainSetCommandOptions extends SystemOutputCommandOptions {
  baseDomain: string;
  publicScheme?: string | undefined;
  tls?: string | undefined;
}

export type SystemDomainStatusCommandOptions = SystemOutputCommandOptions;

export interface SystemDomainVersionedCommandOptions extends SystemOutputCommandOptions {
  expectedVersion?: string | undefined;
}

export type SystemRestartCommandOptions = SystemOutputCommandOptions;

export type SystemStatusCommandOptions = SystemOutputCommandOptions;

export interface UpdateCommandOptions extends SystemOutputCommandOptions {
  imageRegistry?: string | undefined;
  imageSource?: string | undefined;
  version?: string | undefined;
}
