import { Log, type KubeConfig } from '@kubernetes/client-node';
import { StringDecoder } from 'node:string_decoder';
import { Writable } from 'node:stream';
import type { KubeObservation } from './kube-runtime.types';
import type { TerminalJobResult } from './kube-runtime-job-result.types';
import type {
  ActiveLogOutput,
  JobLogStream,
  KubeJobLogChunkHandler,
  KubeJobLogErrorHandler,
  LogOutput,
} from './kube-job-log-stream.types';
import { jobLogAbortError, throwIfJobLogAborted, waitForJobPod } from './kube-job-log-observation';

export class KubeJobLogAttachmentError extends Error {
  public constructor(public readonly attachmentError: Error) {
    super(`Kubernetes Job log attachment failed: ${attachmentError.message}`);
    this.name = 'KubeJobLogAttachmentError';
  }
}

export function followJobLogs(
  kubeConfig: KubeConfig,
  observation: KubeObservation,
  namespace: string,
  jobName: string,
  signal: AbortSignal,
  onLogChunk: KubeJobLogChunkHandler,
): JobLogStream {
  const retryController: AbortController = new AbortController();
  const finished: Promise<void> = followJobLogsUntilDone(
    kubeConfig,
    observation,
    namespace,
    jobName,
    signal,
    retryController.signal,
    onLogChunk,
  );
  return new FollowedJobLogStream(finished, retryController);
}

class FollowedJobLogStream implements JobLogStream {
  public constructor(
    public readonly finished: Promise<void>,
    private readonly retryController: AbortController,
  ) {}

  public stopUnattachedRetries(): void {
    this.retryController.abort();
  }
}

async function followJobLogsUntilDone(
  kubeConfig: KubeConfig,
  observation: KubeObservation,
  namespace: string,
  jobName: string,
  signal: AbortSignal,
  retrySignal: AbortSignal,
  onLogChunk: KubeJobLogChunkHandler,
): Promise<void> {
  const followedPodNames: Set<string> = new Set<string>();
  let podName: string | null = await waitForJobPod(observation, jobName, followedPodNames, signal);
  while (podName !== null) {
    await followPodLogs(kubeConfig, namespace, podName, signal, retrySignal, onLogChunk);
    followedPodNames.add(podName);
    podName = await waitForJobPod(observation, jobName, followedPodNames, signal);
  }
}

async function followPodLogs(
  kubeConfig: KubeConfig,
  namespace: string,
  podName: string,
  signal: AbortSignal,
  retrySignal: AbortSignal,
  onLogChunk: KubeJobLogChunkHandler,
): Promise<void> {
  const output: ActiveLogOutput = await openLogOutputWithRetry(
    kubeConfig,
    namespace,
    podName,
    signal,
    retrySignal,
    onLogChunk,
  );
  const abort: () => void = (): void => abortLogOutput(output);
  registerOutputAbort(signal, abort);
  try {
    await waitForActiveOutput(output);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function waitForActiveOutput(output: ActiveLogOutput): Promise<void> {
  const error: Error | null = await output.finished;
  if (error !== null) {
    throw error;
  }
}

function registerOutputAbort(signal: AbortSignal, abort: () => void): void {
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener('abort', abort, { once: true });
  }
}

function abortLogOutput(output: ActiveLogOutput): void {
  output.controller.abort();
  output.stream.destroy();
}

export async function completeJobWithLogStream(
  completion: Promise<TerminalJobResult>,
  stream: JobLogStream,
  controller: AbortController,
  onLogError?: KubeJobLogErrorHandler,
): Promise<TerminalJobResult> {
  const handledStream: Promise<Error | null> = stream.finished.then(
    (): null => null,
    (error: Error): Error | null => (controller.signal.aborted ? null : error),
  );
  try {
    const result: TerminalJobResult = await completion;
    stream.stopUnattachedRetries();
    const streamError: Error | null = await handledStream;
    reportLogError(streamError, onLogError);
    return result;
  } catch (error) {
    controller.abort(error);
    await handledStream;
    throw error;
  }
}

function reportLogError(error: Error | null, reporter?: KubeJobLogErrorHandler): void {
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
  retrySignal: AbortSignal,
  onLogChunk: KubeJobLogChunkHandler,
): Promise<ActiveLogOutput> {
  let lastAttachmentError: Error | null = null;
  for (;;) {
    throwIfJobLogAborted(signal, podName);
    if (retrySignal.aborted && lastAttachmentError !== null) {
      throw lastAttachmentError;
    }
    try {
      return await openLogOutput(kubeConfig, namespace, podName, onLogChunk);
    } catch (error) {
      lastAttachmentError = error instanceof Error ? error : new Error(String(error));
      await waitForRetry(signal, retrySignal, lastAttachmentError);
    }
  }
}

async function waitForRetry(signal: AbortSignal, retrySignal: AbortSignal, attachmentError: Error): Promise<void> {
  throwIfRetryAborted(signal, retrySignal, attachmentError);
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const abort: () => void = (): void => {
      clearTimeout(timer);
      retrySignal.removeEventListener('abort', stopRetry);
      reject(jobLogAbortError(signal, 'log retry'));
    };
    const stopRetry: () => void = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new KubeJobLogAttachmentError(attachmentError));
    };
    const timer: NodeJS.Timeout = setTimeout((): void => {
      signal.removeEventListener('abort', abort);
      retrySignal.removeEventListener('abort', stopRetry);
      resolve();
    }, 250);
    signal.addEventListener('abort', abort, { once: true });
    retrySignal.addEventListener('abort', stopRetry, { once: true });
  });
}

function throwIfRetryAborted(signal: AbortSignal, retrySignal: AbortSignal, attachmentError: Error): void {
  if (signal.aborted) {
    throw jobLogAbortError(signal, 'log retry');
  }
  if (retrySignal.aborted) {
    throw new KubeJobLogAttachmentError(attachmentError);
  }
}

async function openLogOutput(
  kubeConfig: KubeConfig,
  namespace: string,
  podName: string,
  onLogChunk: KubeJobLogChunkHandler,
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

function createLogOutput(onLogChunk: KubeJobLogChunkHandler): LogOutput {
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
  onLogChunk: KubeJobLogChunkHandler,
  callback: (error?: Error | null) => void,
): void {
  if (chunk === '') {
    callback();
    return;
  }
  void Promise.resolve()
    .then(async (): Promise<void> => await onLogChunk(chunk))
    .then(
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
