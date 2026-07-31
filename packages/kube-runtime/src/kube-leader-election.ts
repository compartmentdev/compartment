import { waitForAbortOrTimeout } from '@compartment/utils';
import type {
  KubeLeaderElectionCallbacks,
  KubeLeaderElectionConfig,
  KubeLeaderElector,
  KubeLeaseRecord,
  KubeLeaseTransport,
  RunKubeLeaderWork,
} from './kube-leader-election.types';

interface LeaderSessionResult {
  lease: KubeLeaseRecord;
  lost: boolean;
}

interface LeaderWorkState {
  stopped: boolean;
}

interface LeaseRenewalState {
  lastRenewedAt: number;
  lease: KubeLeaseRecord;
  lost: boolean;
}

class KubeLeaderElection implements KubeLeaderElector {
  public constructor(
    private readonly transport: KubeLeaseTransport,
    private readonly config: KubeLeaderElectionConfig,
    private readonly callbacks: KubeLeaderElectionCallbacks,
  ) {
    assertLeaderElectionConfig(config);
  }

  public async run(work: RunKubeLeaderWork, shutdownSignal: AbortSignal): Promise<void> {
    this.callbacks.onStandby();
    while (!shutdownSignal.aborted) {
      const lease: KubeLeaseRecord | null = await this.tryAcquire();
      if (lease === null) {
        await waitForAbortOrTimeout(this.config.retryPeriodMs, shutdownSignal);
        continue;
      }
      this.callbacks.onLeader();
      await this.runLeaderSession(work, lease, shutdownSignal);
      this.callbacks.onStandby();
    }
  }

  private async tryAcquire(): Promise<KubeLeaseRecord | null> {
    try {
      return await this.acquire();
    } catch (error) {
      if (error instanceof Error) {
        this.callbacks.onError(error);
        return null;
      }
      throw new Error('Kubernetes Lease acquisition failed with an invalid error.');
    }
  }

  private async acquire(): Promise<KubeLeaseRecord | null> {
    const now: Date = new Date();
    const observed: KubeLeaseRecord | null = await this.transport.read(this.config);
    if (observed === null) {
      return await this.transport.create(this.config, now);
    }
    if (!canAcquire(observed, this.config.identity, now.getTime())) {
      return null;
    }
    return await this.transport.replace(this.config, observed, now);
  }

  private async runLeaderSession(
    work: RunKubeLeaderWork,
    initialLease: KubeLeaseRecord,
    shutdownSignal: AbortSignal,
  ): Promise<void> {
    const leadership: AbortController = new AbortController();
    const stopForShutdown: () => void = (): void => leadership.abort();
    shutdownSignal.addEventListener('abort', stopForShutdown, { once: true });
    const workPromise: Promise<void> = work(leadership.signal);
    let session: LeaderSessionResult = { lease: initialLease, lost: false };
    try {
      session = await this.renewUntilWorkStops(workPromise, leadership, initialLease);
      await workPromise;
    } finally {
      await this.finishLeaderSession(session, leadership, shutdownSignal, stopForShutdown);
    }
  }

  private async finishLeaderSession(
    session: LeaderSessionResult,
    leadership: AbortController,
    shutdownSignal: AbortSignal,
    stopForShutdown: () => void,
  ): Promise<void> {
    try {
      if (!session.lost) {
        await this.transport.release(this.config, session.lease, new Date());
      }
    } finally {
      leadership.abort();
      shutdownSignal.removeEventListener('abort', stopForShutdown);
    }
  }

  private async renewUntilWorkStops(
    workPromise: Promise<void>,
    leadership: AbortController,
    initialLease: KubeLeaseRecord,
  ): Promise<LeaderSessionResult> {
    let renewal: LeaseRenewalState = { lastRenewedAt: Date.now(), lease: initialLease, lost: false };
    const workState: LeaderWorkState = observeLeaderWork(workPromise);
    while (!hasLeaderWorkStopped(workState)) {
      await waitForAbortOrTimeout(this.config.retryPeriodMs);
      if (hasLeaderWorkStopped(workState)) {
        break;
      }
      renewal = await this.renew(renewal);
      if (renewal.lost) {
        leadership.abort();
        return { lease: renewal.lease, lost: true };
      }
    }
    return { lease: renewal.lease, lost: false };
  }

  private async renew(state: LeaseRenewalState): Promise<LeaseRenewalState> {
    try {
      const renewed: KubeLeaseRecord | null = await this.transport.replace(this.config, state.lease, new Date());
      if (renewed?.holderIdentity !== this.config.identity) {
        return { ...state, lost: true };
      }
      return { lastRenewedAt: Date.now(), lease: renewed, lost: false };
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Kubernetes Lease renewal failed.');
      this.callbacks.onError(failure);
      return {
        ...state,
        lost: Date.now() - state.lastRenewedAt >= this.config.renewDeadlineMs,
      };
    }
  }
}

function observeLeaderWork(work: Promise<void>): LeaderWorkState {
  const state: LeaderWorkState = { stopped: false };
  void work.then(
    (): void => {
      state.stopped = true;
    },
    (): void => {
      state.stopped = true;
    },
  );
  return state;
}

function hasLeaderWorkStopped(state: LeaderWorkState): boolean {
  return state.stopped;
}

function assertLeaderElectionConfig(config: KubeLeaderElectionConfig): void {
  if (config.identity.trim() === '' || config.leaseName.trim() === '' || config.namespace.trim() === '') {
    throw new Error('Kubernetes leader election identity, Lease name, and namespace are required.');
  }
  if (config.retryPeriodMs <= 0 || config.renewDeadlineMs <= config.retryPeriodMs) {
    throw new Error('Kubernetes leader election renew deadline must be greater than the retry period.');
  }
  if (config.leaseDurationMs <= config.renewDeadlineMs) {
    throw new Error('Kubernetes leader election renew deadline must be less than the Lease duration.');
  }
}

function canAcquire(lease: KubeLeaseRecord, identity: string, nowMs: number): boolean {
  if (lease.holderIdentity === identity || lease.holderIdentity === null || lease.holderIdentity === '') {
    return true;
  }
  if (lease.renewTime === null || lease.leaseDurationSeconds <= 0) {
    return true;
  }
  return lease.renewTime.getTime() + lease.leaseDurationSeconds * 1000 <= nowMs;
}

export { KubeLeaderElection };
