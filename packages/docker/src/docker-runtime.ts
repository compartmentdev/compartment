import {
  createDockerEngineContainer,
  inspectDockerEngineContainer,
  readDockerEngineContainerLogs,
  removeDockerEngineVolume,
  removeDockerEngineContainer,
} from './docker-engine-runtime';
import { runDockerEngineContainerToCompletion } from './docker-engine-operation-runtime';
import {
  renameDockerEngineContainer,
  startDockerEngineContainer,
  stopDockerEngineContainer,
} from './docker-engine-runtime-rename';
import { updateDockerEngineContainerRestartPolicy } from './docker-engine-runtime-update';
import type {
  DockerInspectContainerInput,
  DockerInspectContainerResult,
  DockerRenameContainerInput,
  DockerRemoveContainerInput,
  DockerRemoveVolumeInput,
  DockerRunContainerInput,
  DockerRunContainerResult,
  DockerRunContainerToCompletionResult,
  DockerStartContainerInput,
  DockerStopContainerInput,
  DockerTailLogsInput,
  DockerTailLogsResult,
  DockerUpdateContainerRestartPolicyInput,
} from './docker-models';

export async function runDockerContainer(input: DockerRunContainerInput): Promise<DockerRunContainerResult> {
  return await createDockerEngineContainer(input);
}

export async function runDockerContainerToCompletion(
  input: DockerRunContainerInput,
): Promise<DockerRunContainerToCompletionResult> {
  return await runDockerEngineContainerToCompletion(input);
}

export async function removeDockerContainer(input: DockerRemoveContainerInput): Promise<void> {
  await removeDockerEngineContainer(input);
}

export async function renameDockerContainer(input: DockerRenameContainerInput): Promise<void> {
  await renameDockerEngineContainer(input);
}

export async function startDockerContainer(input: DockerStartContainerInput): Promise<void> {
  await startDockerEngineContainer(input);
}

export async function stopDockerContainer(input: DockerStopContainerInput): Promise<void> {
  await stopDockerEngineContainer(input);
}

export async function updateDockerContainerRestartPolicy(
  input: DockerUpdateContainerRestartPolicyInput,
): Promise<void> {
  await updateDockerEngineContainerRestartPolicy(input);
}

export async function removeDockerVolume(input: DockerRemoveVolumeInput): Promise<void> {
  await removeDockerEngineVolume(input);
}

export async function inspectDockerContainer(
  input: DockerInspectContainerInput,
): Promise<DockerInspectContainerResult | null> {
  return await inspectDockerEngineContainer(input);
}

export async function tailDockerContainerLogs(input: DockerTailLogsInput): Promise<DockerTailLogsResult> {
  return {
    lines: await readDockerEngineContainerLogs(input),
  };
}
