import type { WorkerJobEntrypoints } from './worker-entrypoints.types';

/**
 * Paths inside the worker image that the worker asks Kubernetes to execute. They are image layout, not
 * container arguments: a path that stops matching the build output surfaces only as a container that exits
 * at start, inside a tenant Pod, so they live in one place the build test can check against the emitted files.
 */
export const workerJobEntrypoints: WorkerJobEntrypoints = {
  awaitResources: 'dist/await-resources-job.js',
  build: 'dist/build-job.js',
  projectProvisioner: 'dist/project-provisioner-job.js',
};

export function workerJobCommand(entrypoint: string): string[] {
  return ['node', entrypoint];
}
