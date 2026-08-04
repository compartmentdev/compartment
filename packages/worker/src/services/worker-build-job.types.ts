import type { WorkerBuildJobInput } from '@compartment/contracts';
import type { DockerProgressLine } from '@compartment/docker';

export type {
  WorkerBuildJobDockerInput,
  WorkerBuildJobInput,
  WorkerBuildJobLogRecord,
  WorkerSourceBuildJobInput,
} from '@compartment/contracts';

export interface RunWorkerBuildJobInput {
  build: WorkerBuildJobInput;
  id: string;
  jobToken: string;
  onProgressLine?: ((line: DockerProgressLine) => void | Promise<void>) | undefined;
}
