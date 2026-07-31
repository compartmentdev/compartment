export interface KubeLeaderElectionConfig {
  identity: string;
  leaseDurationMs: number;
  leaseName: string;
  namespace: string;
  renewDeadlineMs: number;
  retryPeriodMs: number;
}

export interface KubeLeaderElectionCallbacks {
  onError(error: Error): void;
  onLeader(): void;
  onStandby(): void;
}

export type RunKubeLeaderWork = (signal: AbortSignal) => Promise<void>;

export interface KubeLeaderElector {
  run(work: RunKubeLeaderWork, shutdownSignal: AbortSignal): Promise<void>;
}

export interface KubeLeaseRecord {
  holderIdentity: string | null;
  leaseDurationSeconds: number;
  leaseTransitions: number;
  renewTime: Date | null;
  resourceVersion: string;
}

export interface KubeLeaseTransport {
  create(config: KubeLeaderElectionConfig, now: Date): Promise<KubeLeaseRecord | null>;
  read(config: KubeLeaderElectionConfig): Promise<KubeLeaseRecord | null>;
  replace(config: KubeLeaderElectionConfig, lease: KubeLeaseRecord, now: Date): Promise<KubeLeaseRecord | null>;
  release(config: KubeLeaderElectionConfig, lease: KubeLeaseRecord, now: Date): Promise<void>;
}
