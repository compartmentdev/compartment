import type { KubeJobEmptyDirVolume } from '@compartment/kube-runtime';
import type { WorkerBuildSandboxConfig } from '../config.types';
import { parseKubernetesQuantity } from './kubernetes-quantity';

/**
 * gVisor serves every build volume from Sentry memory through the
 * `dev.gvisor.spec.mount.<name>.type=tmpfs` hints, so the whole workspace is charged to the build
 * Pod memory cgroup alongside the BuildKit, runner, and Sentry process memory. A build that
 * exhausted that cgroup was killed with `oom_memcg` naming the Pod slice, not either container.
 * The Sentry never reads the Kubernetes `sizeLimit`, and kubelet cannot measure a mount it does not
 * own, so the Pod memory limit is the only bound that exists. These sizes therefore state what the
 * Pod memory limit must fund, and the installed limits must cover them plus the processes writing
 * into them. The shipped chart defaults sit exactly on that line: 3072Mi of workspace and 1024Mi of
 * process memory against a 4096Mi Pod memory limit.
 */
const buildkitRunSizeLimit: string = '128Mi';
const buildkitTmpSizeLimit: string = '512Mi';
const runnerTmpSizeLimit: string = '384Mi';
const buildSandboxProcessMemory: string = '1Gi';
const megabyte: number = 1_000_000;
const mebibyte: number = 1_048_576;

export function buildSandboxVolumes(config: WorkerBuildSandboxConfig): KubeJobEmptyDirVolume[] {
  return [
    { gvisorTmpfs: true, name: 'buildkit-data', sizeLimit: config.dataSizeLimit },
    { gvisorTmpfs: true, name: 'buildkit-run', sizeLimit: buildkitRunSizeLimit },
    { gvisorTmpfs: true, name: 'buildkit-tmp', sizeLimit: buildkitTmpSizeLimit },
    { containerMountPath: '/tmp', gvisorTmpfs: true, name: 'tmp', sizeLimit: runnerTmpSizeLimit },
  ];
}

export function assertBuildSandboxMemoryBudget(config: WorkerBuildSandboxConfig): void {
  assertWorkspaceFitsPodMemory(config);
  assertRetainedCacheFitsDataVolume(config);
}

function assertWorkspaceFitsPodMemory(config: WorkerBuildSandboxConfig): void {
  const workspace: number = readWorkspaceBytes(config);
  const processMemory: number = parseKubernetesQuantity(buildSandboxProcessMemory, 'memory');
  const budget: number =
    readConfiguredMemoryLimit(config.buildKitResources.limits.memory, 'resources.buildkit.limits.memory') +
    readConfiguredMemoryLimit(config.runnerResources.limits.memory, 'resources.buildRunner.limits.memory');
  if (budget < workspace + processMemory) {
    throw new Error(
      `The build Pod memory limit of ${formatUsed(budget)} does not cover the ${formatUsed(workspace)} gVisor tmpfs ` +
        `build workspace plus ${formatUsed(processMemory)} of BuildKit, runner, and Sentry process memory. Raise ` +
        `resources.buildkit.limits.memory and resources.buildRunner.limits.memory to at least ` +
        `${formatRequired(workspace + processMemory)} in total.`,
    );
  }
}

/**
 * BuildKit reads `--oci-worker-gc-keepstorage` as decimal megabytes of reserved space that garbage
 * collection never prunes below. It is a retention floor rather than a ceiling on the volume, so
 * this only refuses retention the memory-backed data volume can never hold.
 */
function assertRetainedCacheFitsDataVolume(config: WorkerBuildSandboxConfig): void {
  const dataVolume: number = readConfiguredMemoryLimit(config.dataSizeLimit, 'buildkit.dataSizeLimit');
  const retained: number = config.gcKeepStorageMb * megabyte;
  if (retained > dataVolume) {
    throw new Error(
      `buildkit.gcKeepStorageMb reserves ${formatUsed(retained)} of BuildKit cache inside the ` +
        `${formatUsed(dataVolume)} memory-backed build data volume. Lower buildkit.gcKeepStorageMb to at most ` +
        `${String(Math.floor(dataVolume / megabyte))}.`,
    );
  }
}

function readConfiguredMemoryLimit(value: string, valuePath: string): number {
  try {
    return parseKubernetesQuantity(value, 'memory');
  } catch {
    throw new Error(`${valuePath} is not a valid Kubernetes memory quantity: ${value}.`);
  }
}

function readWorkspaceBytes(config: WorkerBuildSandboxConfig): number {
  return [config.dataSizeLimit, buildkitRunSizeLimit, buildkitTmpSizeLimit, runnerTmpSizeLimit].reduce(
    (total: number, sizeLimit: string): number => total + parseKubernetesQuantity(sizeLimit, 'memory'),
    0,
  );
}

function formatUsed(bytes: number): string {
  return `${String(Math.floor(bytes / mebibyte))}Mi`;
}

function formatRequired(bytes: number): string {
  return `${String(Math.ceil(bytes / mebibyte))}Mi`;
}
