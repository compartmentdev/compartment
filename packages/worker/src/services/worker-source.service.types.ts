import type { CompartmentServiceKind, ResolvedCompartmentServiceBuildExecution } from '@compartment/contracts';

export interface WorkerSourceServiceInput {
  kind: CompartmentServiceKind;
  name: string;
  path: string;
}

export interface PreparedWorkerSourceBuildInput {
  appPath?: string | undefined;
  staticOutputDirectory?: string | undefined;
}

export interface PreparedWorkerSource extends ResolvedCompartmentServiceBuildExecution {
  buildContextDirectory: string;
  dockerfilePath?: string | undefined;
  sourceBuildInput?: PreparedWorkerSourceBuildInput | undefined;
  serviceRelativePath: string;
}
