import type { AppRouteAccessMode, CompartmentRouteRule } from '@compartment/contracts';
import type { BuildEnvSnapshot } from './deployment-build.types';
import type { DeploymentSourceProvenance, ResolvedProjectContext } from './deployments.service.types';

export interface PreparedQueuedDeploymentState {
  accessMode: AppRouteAccessMode;
  artifactId: string;
  artifactFingerprint: string;
  buildEnvSnapshot: BuildEnvSnapshot;
  context: ResolvedProjectContext;
  deploymentRunId: string;
  routes: CompartmentRouteRule[];
  sourceProvenance?: DeploymentSourceProvenance | undefined;
  sourceDigest: string;
  sourceUploadId: string;
}
