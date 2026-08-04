import { Log, type KubeConfig } from '@kubernetes/client-node';
import { StringDecoder } from 'node:string_decoder';
import { Writable } from 'node:stream';
import type { KubeObservation } from './kube-runtime.types';
import type { TerminalJobResult } from './kube-runtime-job-result.types';
import type { ActiveLogOutput, LogOutput } from './kube-job-log-stream.types';
import { jobLogAbortError, throwIfJobLogAborted, waitForJobPod } from './kube-job-log-observation';

export async function followJobLogs(
  kubeConfig: KubeConfig,
  observation: KubeObservation,
  namespace: string,
  jobName: string,
  signal: AbortSignal,
  onLogChunk: (chunk: string) => void | Promise<void>,
): Promise<void> {
  const followedPodNames: Set<string> = new Set<string>();
  let podName: string | null = await waitForJobPod(observation, jobName, followedPodNames, signal);
  while (podName !== null) {
    await followPodLogs(kubeConfig, namespace, podName, signal, onLogChunk);
    followedPodNames.add(podName);
    podName = await waitForJobPod(observation, jobName, followedPodNames, signal);
  }
}

async function followPodLogs(
  kubeConfig: KubeConfig,
  namespace: string,
  podName: string,
  signal: AbortSignal,
  onLogChunk: (chunk: string) => void | Promise<void>,
): Promise<void> {
  const output: ActiveLogOutput = await openLogOutputWithRetry(kubeConfig, namespace, podName, signal, onLogChunk);
  const abort: () => void = (): void => abortLogOutput(output);
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener('abort', abort, { once: true });
  }
  try {
    const error: Error | null = await output.finished;
    if (error !== null) {
      throw error;
    }
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function abortLogOutput(output: ActiveLogOutput): void {
  output.controller.abort();
  output.stream.destroy();
}

export async function completeJobWithLogStream(
  completion: Promise<TerminalJobResult>,
  stream: Promise<void>,
  controller: AbortController,
  onLogError?: (error: Error) => void,
): Promise<TerminalJobResult> {
  const handledStream: Promise<Error | null> = stream.then(
    (): null => null,
    (error: Error): Error | null => (controller.signal.aborted ? null : error),
  );
  try {
    const result: TerminalJobResult = await completion;
    const streamError: Error | null = await handledStream;
    reportLogError(streamError, onLogError);
    return result;
  } catch (error) {
    controller.abort(error);
    await handledStream;
    throw error;
  }
}

function reportLogError(error: Error | null, reporter?: (error: Error) => void): void {
  if (error !== null && reporter === undefined) {
    throw error;
  }
  if (error !== null) {
    reporter?.(error);
  }
}

async function openLogOutputWithRetry(
  kubeConfig: KubeConfig,
  namespace: string,
  podName: string,
  signal: AbortSignal,
  onLogChunk: (chunk: string) => void | Promise<void>,
): Promise<ActiveLogOutput> {
  for (;;) {
    throwIfJobLogAborted(signal, podName);
    try {
      return await openLogOutput(kubeConfig, namespace, podName, onLogChunk);
    } catch {
      await waitForRetry(signal);
    }
  }
}

async function waitForRetry(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const abort: () => void = (): void => {
      clearTimeout(timer);
      reject(jobLogAbortError(signal, 'log retry'));
    };
    const timer: NodeJS.Timeout = setTimeout((): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 250);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function openLogOutput(
  kubeConfig: KubeConfig,
  namespace: string,
  podName: string,
  onLogChunk: (chunk: string) => void | Promise<void>,
): Promise<ActiveLogOutput> {
  const output: LogOutput = createLogOutput(onLogChunk);
  try {
    const controller: AbortController = await new Log(kubeConfig).log(namespace, podName, 'job', output.stream, {
      follow: true,
    });
    return { ...output, controller };
  } catch (error) {
    output.stream.destroy();
    await output.finished;
    throw error;
  }
}

function createLogOutput(onLogChunk: (chunk: string) => void | Promise<void>): LogOutput {
  const decoder: StringDecoder = new StringDecoder('utf8');
  const stream: Writable = new Writable({
    final(callback: (error?: Error | null) => void): void {
      publishDecoded(decoder.end(), onLogChunk, callback);
    },
    write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      publishDecoded(decoder.write(chunk), onLogChunk, callback);
    },
  });
  return { finished: waitForStream(stream), stream };
}

function publishDecoded(
  chunk: string,
  onLogChunk: (chunk: string) => void | Promise<void>,
  callback: (error?: Error | null) => void,
): void {
  if (chunk === '') {
    callback();
    return;
  }
  void Promise.resolve(onLogChunk(chunk)).then(
    (): void => callback(),
    (error: Error): void => callback(error),
  );
}

async function waitForStream(stream: Writable): Promise<Error | null> {
  return await new Promise<Error | null>((resolve: (error: Error | null) => void): void => {
    stream.once('close', (): void => resolve(null));
    stream.once('finish', (): void => resolve(null));
    stream.once('error', (error: Error): void => resolve(error));
  });
}
