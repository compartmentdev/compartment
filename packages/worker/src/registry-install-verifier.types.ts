import type { DockerBuildImageInput } from '@compartment/docker';

export interface RegistryInstallVerificationOutput {
  dockerConfigJson: string;
  imageRef: string;
}

export interface RegistryVerificationBuildContext {
  buildInput: DockerBuildImageInput;
  directory: string;
}
