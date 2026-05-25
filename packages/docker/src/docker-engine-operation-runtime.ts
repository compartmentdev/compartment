import type Docker from 'dockerode';
import { createDockerClient } from './docker-client';
import { buildDockerContainerCreateOptions } from './docker-engine-runtime-create';
import { ensureDockerEngineVolumes, removeDockerEngineContainer } from './docker-engine-runtime';
import { parseDockerMultiplexedLogBuffer } from './docker-log-buffer';
import type { DockerLogLine, DockerRunContainerInput, DockerRunContainerToCompletionResult } from './docker-models';

interface DockerContainerWaitResult {
  StatusCode: number;
}

interface DockerOperationOutput {
  logs: DockerLogLine[];
  stderr: string;
  stdout: string;
}

type DockerOperationStream = 'stderr' | 'stdout';
type DockerOperationTimeoutHandle = NodeJS.Timeout;
type DockerOperationTimeoutReject = (reason: Error) => void;
type DockerOperationTimeoutResolve = (value: never) => void;
type DockerOperationTimeoutSetter = (handle: DockerOperationTimeoutHandle) => void;
type DockerOperationFailureReason = Error | string | number | boolean | symbol | bigint | null | undefined;

export async function runDockerEngineContainerToCompletion(
  input: DockerRunContainerInput,
): Promise<DockerRunContainerToCompletionResult> {
  const container: Docker.Container = await createDockerOperationContainer(input);

  try {
    return await runCreatedDockerOperationContainer(input.containerName, container, input.timeoutMs);
  } finally {
    await removeDockerEngineContainer({ containerRef: container.id });
  }
}

async function createDockerOperationContainer(input: DockerRunContainerInput): Promise<Docker.Container> {
  const docker: Docker = await createDockerClient();
  await ensureDockerEngineVolumes(docker, input.namedVolumes ?? []);

  return await docker.createContainer(buildDockerContainerCreateOptions(input));
}

async function runCreatedDockerOperationContainer(
  containerName: string,
  container: Docker.Container,
  timeoutMs: number | undefined,
): Promise<DockerRunContainerToCompletionResult> {
  await container.start();
  const waitResult: DockerContainerWaitResult = await waitForDockerOperationContainer(
    containerName,
    container,
    timeoutMs,
  ).catch(async (error: DockerOperationFailureReason): Promise<never> => {
    const output: DockerOperationOutput = await readDockerOperationOutputSafely(container);
    throw buildDockerOperationError(error, output);
  });
  const output: DockerOperationOutput = await readDockerOperationOutput(container);
  if (waitResult.StatusCode !== 0) {
    throw buildDockerOperationContainerFailure(containerName, waitResult.StatusCode, output);
  }

  return { containerId: container.id, logs: output.logs, stderr: output.stderr, stdout: output.stdout };
}

async function waitForDockerOperationContainer(
  containerName: string,
  container: Docker.Container,
  timeoutMs: number | undefined,
): Promise<DockerContainerWaitResult> {
  if (timeoutMs === undefined) {
    return (await container.wait()) as DockerContainerWaitResult;
  }

  return await waitForDockerOperationContainerWithTimeout(containerName, container, timeoutMs);
}

async function waitForDockerOperationContainerWithTimeout(
  containerName: string,
  container: Docker.Container,
  timeoutMs: number,
): Promise<DockerContainerWaitResult> {
  let timeoutHandle: DockerOperationTimeoutHandle | undefined;
  try {
    return await Promise.race([
      container.wait() as Promise<DockerContainerWaitResult>,
      createDockerOperationTimeout(containerName, timeoutMs, (handle: DockerOperationTimeoutHandle): void => {
        timeoutHandle = handle;
      }),
    ]);
  } catch (error) {
    await stopTimedOutDockerOperationContainer(container);
    throw error;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function createDockerOperationTimeout(
  containerName: string,
  timeoutMs: number,
  setHandle: DockerOperationTimeoutSetter,
): Promise<never> {
  return await new Promise<never>(
    (_resolve: DockerOperationTimeoutResolve, reject: DockerOperationTimeoutReject): void => {
      setHandle(
        setTimeout((): void => {
          reject(new Error(`Docker operation container ${containerName} timed out after ${timeoutMs}ms.`));
        }, timeoutMs),
      );
    },
  );
}

async function stopTimedOutDockerOperationContainer(container: Docker.Container): Promise<void> {
  try {
    await container.stop({ t: 1 });
  } catch {
    return;
  }
}

async function readDockerOperationOutputSafely(container: Docker.Container): Promise<DockerOperationOutput> {
  try {
    return await readDockerOperationOutput(container);
  } catch {
    return {
      logs: [],
      stderr: '',
      stdout: '',
    };
  }
}

async function readDockerOperationOutput(container: Docker.Container): Promise<DockerOperationOutput> {
  const logsBuffer: Buffer = await container.logs({
    stderr: true,
    stdout: true,
    timestamps: false,
  });

  return parseDockerOperationLogs(logsBuffer);
}

function parseDockerOperationLogs(logsBuffer: Buffer): DockerOperationOutput {
  const lines: DockerLogLine[] = parseDockerMultiplexedLogBuffer(logsBuffer, { timestamps: false });

  return {
    logs: lines,
    stderr: readDockerOperationStream(lines, 'stderr'),
    stdout: readDockerOperationStream(lines, 'stdout'),
  };
}

function readDockerOperationStream(lines: DockerLogLine[], stream: DockerOperationStream): string {
  return lines
    .filter((line: DockerLogLine): boolean => line.stream === stream)
    .map((line: DockerLogLine): string => line.message)
    .join('\n');
}

function buildDockerOperationContainerFailure(
  containerName: string,
  statusCode: number,
  output: DockerOperationOutput,
): Error {
  return buildDockerOperationError(
    `Docker operation container ${containerName} failed with exit code ${statusCode}.`,
    output,
  );
}

function buildDockerOperationError(reason: DockerOperationFailureReason, output: DockerOperationOutput): Error {
  const message: string = reason instanceof Error ? reason.message : String(reason);
  const error: Error & {
    logs?: DockerLogLine[] | undefined;
    stderr?: string | undefined;
    stdout?: string | undefined;
  } = new Error(message);
  error.logs = output.logs;
  error.stderr = output.stderr;
  error.stdout = output.stdout;

  return error;
}
