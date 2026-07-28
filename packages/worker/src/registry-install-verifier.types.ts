import type { DockerBuildImageInput } from '@compartment/docker';

export interface RegistryVerificationBuildContext {
  buildInput: DockerBuildImageInput;
  directory: string;
}
