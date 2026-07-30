import type {
  CompartmentServiceKind,
  ResolvedCompartmentServiceBuildConfig,
  ResolvedCompartmentServiceRunConfig,
} from '@compartment/contracts';
import type { DockerBuildImageResult, DockerProgressLine, DockerRegistryCredentials } from '@compartment/docker';

export interface WorkerBuildJobDockerInput {
  buildEnv?: Record<string, string> | undefined;
  cacheImageRef?: string | undefined;
  imageTag: string;
  labels: Record<string, string>;
  pushImageInsecureRegistry: boolean;
  pushImageTag: string;
  pushRegistryCredentials: DockerRegistryCredentials;
}

export interface WorkerBuildJobServiceInput {
  build: ResolvedCompartmentServiceBuildConfig;
  kind: CompartmentServiceKind;
  name: string;
  path: string;
  requiresRoutesFile: boolean;
  run: ResolvedCompartmentServiceRunConfig;
}

export interface WorkerSourceBuildJobInput {
  apiUrl: string;
  artifactId: string;
  docker: WorkerBuildJobDockerInput;
  kind: 'source';
  service: WorkerBuildJobServiceInput;
}

export interface WorkerRegistryVerificationBuildJobInput {
  docker: WorkerBuildJobDockerInput;
  dockerfile: string;
  kind: 'registry-verification';
}

export type WorkerBuildJobInput = WorkerRegistryVerificationBuildJobInput | WorkerSourceBuildJobInput;

export interface RunWorkerBuildJobInput {
  build: WorkerBuildJobInput;
  id: string;
  internalToken: string;
  onProgressLine?: ((line: DockerProgressLine) => void | Promise<void>) | undefined;
}

export interface WorkerBuildJobLogResult {
  result: DockerBuildImageResult;
  type: 'result';
}

export interface WorkerBuildJobLogFailure {
  message: string;
  type: 'failure';
}

export interface WorkerBuildJobLogProgress {
  progress: DockerProgressLine;
  type: 'progress';
}

export type WorkerBuildJobLogRecord = WorkerBuildJobLogFailure | WorkerBuildJobLogProgress | WorkerBuildJobLogResult;
