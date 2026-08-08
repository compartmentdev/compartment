import type { WorkerConfig } from '../src/config';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';

export class DeferredValue<T> {
  readonly promise: Promise<T>;
  private resolvePromise?: ((value: T) => void) | undefined;
  private rejectPromise?: ((error: Error) => void) | undefined;

  constructor() {
    this.promise = new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  reject(error: Error): void {
    this.rejectPromise?.(error);
  }

  resolve(value: T): void {
    this.resolvePromise?.(value);
  }
}

export function createWorkerAppTestConfig(maximumConcurrentBuilds: number): WorkerConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    artifactRegistry: createArtifactRegistryConfig(),
    buildSandbox: {
      buildKitResources: {},
      gcKeepStorageMb: 2000,
      namespace: 'compartment-build',
      runnerImage: 'compartment-worker@sha256:runner',
      runnerResources: {},
      scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
      timeoutMs: 900000,
    },
    buildQueue: { maximumConcurrentBuilds, maximumConcurrentBuildsPerOrganization: 1 },
    customDomains: {
      caddyServiceName: 'compartment-caddy',
      ingressClassName: 'traefik',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      namespace: 'compartment',
    },
    deploymentInfrastructureTimeoutMs: 600_000,
    logLevel: 'silent',
    leaderElection: {
      identity: 'worker-1',
      leaseDurationMs: 15_000,
      renewDeadlineMs: 10_000,
      retryPeriodMs: 2_000,
    },
    pollIntervalMs: 10,
    runtimeControlToken: 'worker-secret',
    tenantSecretsKek: { current: Buffer.alloc(32, 1) },
    usageMeteringIntervalMs: 60_000,
  };
}

function createArtifactRegistryConfig(): WorkerArtifactRegistryConfig {
  return {
    address: '127.0.0.1:5517',
    credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
    internalAddress: 'registry:5000',
    internalUrl: 'http://registry:5000',
  };
}
