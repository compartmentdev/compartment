import type { DockerBuildImageResult } from '@compartment/docker';

export interface ScheduledWorkerBuild {
  reject: (error: Error) => void;
  resolve: (result: DockerBuildImageResult) => void;
  run: () => Promise<DockerBuildImageResult>;
}
