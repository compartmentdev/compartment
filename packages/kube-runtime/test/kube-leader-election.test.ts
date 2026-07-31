import { describe, expect, it, vi } from 'vitest';
import { KubeLeaderElection } from '../src/kube-leader-election';
import type {
  KubeLeaderElectionCallbacks,
  KubeLeaderElectionConfig,
  KubeLeaseRecord,
  KubeLeaseTransport,
  RunKubeLeaderWork,
} from '../src/kube-leader-election.types';

class MemoryLeaseTransport implements KubeLeaseTransport {
  public lease: KubeLeaseRecord | null = null;
  public rejectRenewal: boolean = false;
  private version: number = 0;

  public async create(electionConfig: KubeLeaderElectionConfig, now: Date): Promise<KubeLeaseRecord | null> {
    if (this.lease !== null) {
      return await Promise.resolve(null);
    }
    this.lease = this.record(electionConfig, now, 0);
    return await Promise.resolve(this.lease);
  }

  public async read(): Promise<KubeLeaseRecord | null> {
    return await Promise.resolve(this.lease);
  }

  public async replace(
    electionConfig: KubeLeaderElectionConfig,
    lease: KubeLeaseRecord,
    now: Date,
  ): Promise<KubeLeaseRecord | null> {
    if (this.rejectRenewal || this.lease?.resourceVersion !== lease.resourceVersion) {
      return await Promise.resolve(null);
    }
    const transitions: number =
      lease.holderIdentity === electionConfig.identity ? lease.leaseTransitions : lease.leaseTransitions + 1;
    this.lease = this.record(electionConfig, now, transitions);
    return await Promise.resolve(this.lease);
  }

  public async release(electionConfig: KubeLeaderElectionConfig, lease: KubeLeaseRecord, now: Date): Promise<void> {
    if (this.lease?.resourceVersion === lease.resourceVersion && lease.holderIdentity === electionConfig.identity) {
      this.version += 1;
      this.lease = { ...lease, holderIdentity: '', renewTime: now, resourceVersion: this.version.toString() };
    }
    await Promise.resolve();
  }

  private record(electionConfig: KubeLeaderElectionConfig, now: Date, transitions: number): KubeLeaseRecord {
    this.version += 1;
    return {
      holderIdentity: electionConfig.identity,
      leaseDurationSeconds: Math.ceil(electionConfig.leaseDurationMs / 1000),
      leaseTransitions: transitions,
      renewTime: now,
      resourceVersion: this.version.toString(),
    };
  }
}

describe('Kubernetes Lease leader election', (): void => {
  it('runs work on only one leader and keeps the other candidate on hot standby', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const transport: MemoryLeaseTransport = new MemoryLeaseTransport();
      const firstShutdown: AbortController = new AbortController();
      const secondShutdown: AbortController = new AbortController();
      let active: number = 0;
      let maximumActive: number = 0;
      const leaders: string[] = [];
      const first: Promise<void> = runCandidate(
        'worker-1',
        transport,
        firstShutdown,
        leaders,
        (): void => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
        },
        (): void => {
          active -= 1;
        },
      );
      const second: Promise<void> = runCandidate(
        'worker-2',
        transport,
        secondShutdown,
        leaders,
        (): void => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
        },
        (): void => {
          active -= 1;
        },
      );

      await vi.advanceTimersByTimeAsync(20);
      expect(leaders).toEqual(['worker-1']);
      expect(maximumActive).toBe(1);
      firstShutdown.abort();
      await vi.advanceTimersByTimeAsync(20);
      expect(leaders).toEqual(['worker-1', 'worker-2']);
      expect(maximumActive).toBe(1);

      secondShutdown.abort();
      await vi.runAllTimersAsync();
      await Promise.all([first, second]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts leader work when renewal loses the Lease', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const transport: MemoryLeaseTransport = new MemoryLeaseTransport();
      const shutdown: AbortController = new AbortController();
      let stopped: boolean = false;
      const election: KubeLeaderElection = new KubeLeaderElection(transport, leaderConfig('worker-1'), callbacks());
      const running: Promise<void> = election.run(async (signal: AbortSignal): Promise<void> => {
        await untilAborted(signal);
        stopped = true;
        shutdown.abort();
      }, shutdown.signal);
      await vi.advanceTimersByTimeAsync(5);
      transport.rejectRenewal = true;
      await vi.advanceTimersByTimeAsync(20);
      await running;
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not claim the same queued task twice across a leader handoff', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const transport: MemoryLeaseTransport = new MemoryLeaseTransport();
      const queue: string[] = ['deployment-1'];
      const claims: string[] = [];
      const firstShutdown: AbortController = new AbortController();
      const secondShutdown: AbortController = new AbortController();
      const runQueue: RunKubeLeaderWork = async (signal: AbortSignal): Promise<void> => {
        const task: string | undefined = queue.shift();
        if (task !== undefined) {
          claims.push(task);
        }
        await untilAborted(signal);
      };
      const first: Promise<void> = new KubeLeaderElection(transport, leaderConfig('worker-1'), callbacks()).run(
        runQueue,
        firstShutdown.signal,
      );
      const second: Promise<void> = new KubeLeaderElection(transport, leaderConfig('worker-2'), callbacks()).run(
        runQueue,
        secondShutdown.signal,
      );
      await vi.advanceTimersByTimeAsync(10);
      firstShutdown.abort();
      await vi.advanceTimersByTimeAsync(20);
      expect(claims).toEqual(['deployment-1']);
      secondShutdown.abort();
      await vi.runAllTimersAsync();
      await Promise.all([first, second]);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function runCandidate(
  identity: string,
  transport: MemoryLeaseTransport,
  shutdown: AbortController,
  leaders: string[],
  started: () => void,
  stopped: () => void,
): Promise<void> {
  await new KubeLeaderElection(
    transport,
    leaderConfig(identity),
    callbacks((): void => {
      leaders.push(identity);
    }),
  ).run(async (signal: AbortSignal): Promise<void> => {
    started();
    await untilAborted(signal);
    stopped();
  }, shutdown.signal);
}

function leaderConfig(identity: string): KubeLeaderElectionConfig {
  return {
    identity,
    leaseDurationMs: 15,
    leaseName: 'compartment-worker',
    namespace: 'compartment',
    renewDeadlineMs: 10,
    retryPeriodMs: 2,
  };
}

class TestLeaderElectionCallbacks implements KubeLeaderElectionCallbacks {
  public constructor(private readonly leaderCallback: () => void = (): void => undefined) {}

  public onError(): void {
    return;
  }

  public onLeader(): void {
    this.leaderCallback();
  }

  public onStandby(): void {
    return;
  }
}

function callbacks(onLeader: () => void = (): void => undefined): KubeLeaderElectionCallbacks {
  return new TestLeaderElectionCallbacks(onLeader);
}

async function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve: () => void): void => {
    signal.addEventListener('abort', (): void => resolve(), { once: true });
  });
}
