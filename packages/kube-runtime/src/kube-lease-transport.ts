import { CoordinationV1Api, type KubeConfig, type V1Lease, V1MicroTime } from '@kubernetes/client-node';
import type { KubeLeaderElectionConfig, KubeLeaseRecord, KubeLeaseTransport } from './kube-leader-election.types';

interface KubeHttpError extends Error {
  code?: number | undefined;
  statusCode?: number | undefined;
}

export class ClientNodeKubeLeaseTransport implements KubeLeaseTransport {
  private readonly api: CoordinationV1Api;

  public constructor(kubeConfig: KubeConfig) {
    this.api = kubeConfig.makeApiClient(CoordinationV1Api);
  }

  public async create(config: KubeLeaderElectionConfig, now: Date): Promise<KubeLeaseRecord | null> {
    try {
      return toLeaseRecord(
        await this.api.createNamespacedLease({
          body: leaseManifest(config, null, now, 0),
          fieldManager: 'compartment-leader-election',
          namespace: config.namespace,
        }),
      );
    } catch (error) {
      if (httpStatus(error as KubeHttpError) === 409) {
        return null;
      }
      throw error;
    }
  }

  public async read(config: KubeLeaderElectionConfig): Promise<KubeLeaseRecord | null> {
    try {
      return toLeaseRecord(await this.api.readNamespacedLease({ name: config.leaseName, namespace: config.namespace }));
    } catch (error) {
      if (httpStatus(error as KubeHttpError) === 404) {
        return null;
      }
      throw error;
    }
  }

  public async replace(
    config: KubeLeaderElectionConfig,
    lease: KubeLeaseRecord,
    now: Date,
  ): Promise<KubeLeaseRecord | null> {
    try {
      const transitions: number =
        lease.holderIdentity === config.identity ? lease.leaseTransitions : lease.leaseTransitions + 1;
      return toLeaseRecord(
        await this.api.replaceNamespacedLease({
          body: leaseManifest(config, lease.resourceVersion, now, transitions),
          fieldManager: 'compartment-leader-election',
          name: config.leaseName,
          namespace: config.namespace,
        }),
      );
    } catch (error) {
      if (httpStatus(error as KubeHttpError) === 404 || httpStatus(error as KubeHttpError) === 409) {
        return null;
      }
      throw error;
    }
  }

  public async release(config: KubeLeaderElectionConfig, lease: KubeLeaseRecord, now: Date): Promise<void> {
    if (lease.holderIdentity !== config.identity) {
      return;
    }
    try {
      await this.api.replaceNamespacedLease({
        body: leaseManifest(config, lease.resourceVersion, now, lease.leaseTransitions, ''),
        fieldManager: 'compartment-leader-election',
        name: config.leaseName,
        namespace: config.namespace,
      });
    } catch (error) {
      if (httpStatus(error as KubeHttpError) !== 404 && httpStatus(error as KubeHttpError) !== 409) {
        throw error;
      }
    }
  }
}

function leaseManifest(
  config: KubeLeaderElectionConfig,
  resourceVersion: string | null,
  now: Date,
  leaseTransitions: number,
  holderIdentity: string = config.identity,
): V1Lease {
  const microTime: V1MicroTime = new V1MicroTime(now);
  return {
    apiVersion: 'coordination.k8s.io/v1',
    kind: 'Lease',
    metadata: {
      name: config.leaseName,
      namespace: config.namespace,
      ...(resourceVersion === null ? {} : { resourceVersion }),
    },
    spec: {
      acquireTime: microTime,
      holderIdentity,
      leaseDurationSeconds: Math.ceil(config.leaseDurationMs / 1000),
      leaseTransitions,
      renewTime: microTime,
    },
  };
}

function toLeaseRecord(lease: V1Lease): KubeLeaseRecord {
  const resourceVersion: string | undefined = lease.metadata?.resourceVersion;
  if (resourceVersion === undefined) {
    throw new Error('Kubernetes Lease response is missing metadata.resourceVersion.');
  }
  return {
    holderIdentity: lease.spec?.holderIdentity ?? null,
    leaseDurationSeconds: lease.spec?.leaseDurationSeconds ?? 0,
    leaseTransitions: lease.spec?.leaseTransitions ?? 0,
    renewTime: lease.spec?.renewTime === undefined ? null : new Date(lease.spec.renewTime),
    resourceVersion,
  };
}

function httpStatus(error: KubeHttpError): number | undefined {
  const httpError: KubeHttpError = error;
  return httpError.statusCode ?? httpError.code;
}
