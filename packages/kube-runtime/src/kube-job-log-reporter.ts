import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Log } from '@kubernetes/client-node';
import { findJobPodNames } from './kube-runtime-operations';
import type { KubeJobLogReporter, KubeJobSpec, KubeObservation, KubeObservationEvent } from './kube-runtime.types';

interface FollowedPodLog {
  controller: AbortController;
  stream: Writable;
}

const terminalLogDrainTimeoutMs: number = 1_000;

export class JobLogReporter {
  private readonly buffers: Map<string, string> = new Map<string, string>();
  private readonly completedPods: Set<string> = new Set<string>();
  private readonly followedLogs: Map<string, FollowedPodLog> = new Map<string, FollowedPodLog>();
  private readonly openings: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  private queue: Promise<void> = Promise.resolve();
  private readonly timer: NodeJS.Timeout;
  private readonly unsubscribe: () => void;

  public constructor(
    private readonly logClient: Log,
    private readonly namespace: string,
    private readonly reporter: KubeJobLogReporter,
    private readonly observation: KubeObservation,
    private readonly jobName: string,
  ) {
    this.timer = setInterval((): void => this.enqueueObservedPods(), 250);
    this.timer.unref();
    this.unsubscribe = observation.onEvent((event: KubeObservationEvent): void =>
      enqueueObservedPod(this, event, jobName),
    );
  }

  public enqueue(podName: string): void {
    if (this.completedPods.has(podName) || this.followedLogs.has(podName) || this.openings.has(podName)) {
      return;
    }
    const opening: Promise<void> = this.follow(podName);
    this.openings.set(podName, opening);
    void opening.finally((): void => {
      this.openings.delete(podName);
    });
  }

  public async stopAndFlush(podNames: readonly string[]): Promise<void> {
    clearInterval(this.timer);
    this.unsubscribe();
    for (const podName of podNames) {
      this.enqueue(podName);
    }
    await Promise.all(this.openings.values());
    await Promise.all(
      [...this.followedLogs.values()].map(
        async (followed: FollowedPodLog): Promise<void> => await waitForTerminalLogDrain(followed.stream),
      ),
    );
    for (const followed of this.followedLogs.values()) {
      followed.controller.abort();
      followed.stream.end();
    }
    await this.queue;
    for (const podName of podNames) {
      await this.flushPartialLine(podName);
    }
  }

  private enqueueObservedPods(): void {
    for (const podName of findJobPodNames(this.observation.cache, this.jobName)) {
      this.enqueue(podName);
    }
  }

  private async follow(podName: string): Promise<void> {
    const stream: Writable = this.createStream(podName);
    stream.on('finish', (): void => this.complete(podName));
    stream.on('error', (): void => this.fail(podName));
    try {
      const controller: AbortController = await this.logClient.log(this.namespace, podName, 'job', stream, {
        follow: true,
      });
      if (this.completedPods.has(podName)) {
        controller.abort();
      } else {
        this.followedLogs.set(podName, { controller, stream });
      }
    } catch {
      stream.destroy();
    }
  }

  private createStream(podName: string): Writable {
    return new Writable({
      write: (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void => {
        this.queue = this.queue.then(async (): Promise<void> => await this.reportChunk(podName, chunk.toString()));
        void this.queue.then((): void => callback(), callback);
      },
    });
  }

  private complete(podName: string): void {
    this.completedPods.add(podName);
    this.followedLogs.delete(podName);
  }

  private fail(podName: string): void {
    this.followedLogs.delete(podName);
  }

  private async reportChunk(podName: string, chunk: string): Promise<void> {
    const logs: string = `${this.buffers.get(podName) ?? ''}${chunk}`;
    const lines: string[] = logs.split('\n');
    this.buffers.set(podName, lines.pop() ?? '');
    for (const line of lines) {
      if (line !== '') {
        await this.reporter(line);
      }
    }
  }

  private async flushPartialLine(podName: string): Promise<void> {
    const partialLine: string = this.buffers.get(podName) ?? '';
    this.buffers.delete(podName);
    if (partialLine !== '') {
      await this.reporter(partialLine);
    }
  }
}

async function waitForTerminalLogDrain(stream: Writable): Promise<void> {
  await Promise.race([finished(stream).catch((): void => undefined), sleep(terminalLogDrainTimeoutMs)]);
}

export function startJobLogReporter(
  logClient: Log,
  spec: KubeJobSpec,
  observation: KubeObservation,
  jobName: string,
): JobLogReporter | null {
  if (spec.onLogLine === undefined) {
    return null;
  }
  const reporter: JobLogReporter = new JobLogReporter(logClient, spec.namespace, spec.onLogLine, observation, jobName);
  for (const podName of findJobPodNames(observation.cache, jobName)) {
    reporter.enqueue(podName);
  }
  return reporter;
}

function enqueueObservedPod(reporter: JobLogReporter, event: KubeObservationEvent, jobName: string): void {
  if (
    event.type !== 'relist' &&
    event.resource === 'pods' &&
    event.object.metadata?.labels?.['job-name'] === jobName &&
    event.object.metadata.name !== undefined
  ) {
    reporter.enqueue(event.object.metadata.name);
  }
}
