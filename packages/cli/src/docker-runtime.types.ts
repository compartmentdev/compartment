import type {
  SystemServiceHealth,
  SystemServiceName,
  SystemServicePublishedPort,
  SystemServiceStatus,
} from '@compartment/contracts';
import type { ConfirmInstallWhenMissing, InstallImageSource, InstallProgressReporter } from './install.types';
import type { SelfHostedImageRefs } from './self-hosted-env.types';

export type DockerExecutionMode = 'direct' | 'sudo-n' | 'sudo';

export interface DockerExecutionContext {
  dockerCommand: readonly string[];
  isRootlessDocker: boolean;
  mode: DockerExecutionMode;
}

export interface EnsureDockerExecutionContextOptions {
  allowInteractiveSudo?: boolean | undefined;
  confirmInstallWhenMissing?: ConfirmInstallWhenMissing | undefined;
  installWhenMissing?: boolean | undefined;
  reportProgress?: InstallProgressReporter | undefined;
}

export interface DockerComposePaths {
  composePath: string;
  envPath: string;
  installDirectory: string;
  localComposePath: string;
}

export interface PrepareSelfHostedRuntimeImagesInput extends DockerComposePaths {
  imageRefs: SelfHostedImageRefs;
  imageSource: InstallImageSource;
  reportProgress?: InstallProgressReporter | undefined;
}

export interface SelfHostedRuntimeCommandInput extends DockerComposePaths {
  imageSource: InstallImageSource;
  reportProgress?: InstallProgressReporter | undefined;
}

export interface StartSelfHostedRuntimeInput extends SelfHostedRuntimeCommandInput {
  imageRefs: SelfHostedImageRefs;
  skipRequiredImageVerificationBeforeStart?: boolean | undefined;
}

export interface SelfHostedRuntimeServiceInspection {
  containerId: string | null;
  health: SystemServiceHealth | null;
  imageRef: string | null;
  name: SystemServiceName;
  publishedPorts: SystemServicePublishedPort[];
  startedAt: string | null;
  status: SystemServiceStatus;
}

export type RestartSelfHostedRuntimeInput = StartSelfHostedRuntimeInput;

export interface InspectSelfHostedRuntimeInput extends SelfHostedRuntimeCommandInput {
  nodeSocketPath: string;
}
