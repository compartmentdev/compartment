import type { ResolvedCompartmentServiceBuildConfig } from '@compartment/contracts';
import type { BuildEnvSnapshot } from './deployment-build.types';

export interface BuildArtifactFingerprintInput {
  build: ResolvedCompartmentServiceBuildConfig;
  buildEnvSnapshot: BuildEnvSnapshot;
  organizationId: string;
  projectId: string;
  projectServiceId: string;
  sourceDigest: string;
}
