import type { RailpackBuildSecrets } from './docker-build.types';
import type { DockerBuildImageInput } from './docker-models';

export interface BuildKitDockerfilePaths {
  dockerfileDirectory: string;
  dockerfileName: string;
}

export interface BuildKitImageMetadataDescriptor {
  digest?: string | undefined;
}

export interface BuildKitImageMetadata {
  'containerimage.descriptor'?: BuildKitImageMetadataDescriptor | null | undefined;
  'containerimage.digest'?: string | undefined;
}

export interface BuildKitRailpackBuildctlInput {
  buildKitAddress: string;
  contextDirectory: string;
  dockerfileDirectory: string;
  output?: string;
}

export interface BuildKitDockerfileBuildctlInput {
  buildKitAddress: string;
  input: DockerBuildImageInput;
  metadataFile: string;
}

export interface BuildKitRailpackImageBuildctlInput {
  buildKitAddress: string;
  input: DockerBuildImageInput;
  metadataFile: string;
  railpackDirectory: string;
  railpackSecrets: RailpackBuildSecrets;
}
