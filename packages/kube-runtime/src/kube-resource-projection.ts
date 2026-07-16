import type {
  ExpectedResourceClaim,
  ObservedResourceClaim,
  ResourceProjectionRow,
  ResourceVolumeProjection,
} from './kube-resource-projection.types';
import type { KubeContainerPort, KubeReadinessProbe } from './kube-application-projection.types';
import type {
  KubeDeploymentManifest,
  KubeManifest,
  KubePodTemplate,
  KubePodVolume,
  KubeProjectedContainer,
  KubeServicePort,
  KubeVolumeMount,
} from './kube-runtime.types';
import { kubeNamespaceName, kubeResourceName, kubeResourceVolumeName, kubeSecretName } from './kube-naming';
import { projectSecretManifest, secretChecksum, secretEnvironment } from './kube-secret-projection';

const managedByLabel: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };
const resourceBackupVolumeHandle: string = 'backup-artifacts';

/** Ordinary reconcile bundle. PVC creation is deliberately not representable here. */
export function projectResourceManifests(row: ResourceProjectionRow, replicas: 0 | 1 = 1): KubeManifest[] {
  const name: string = kubeResourceName(row.resourceId);
  const namespace: string = kubeNamespaceName(row.namespaceId);
  const labels: Record<string, string> = {
    ...managedByLabel,
    app: 'resource',
    'compartment.dev/environment-id': row.environmentId,
    'compartment.dev/resource-id': row.resourceId,
  };
  const secret: KubeManifest = resourceSecret(row);
  const deployment: KubeManifest = resourceDeployment(row, replicas, labels, name, namespace);
  return [secret, deployment, resourceService(row, labels, name, namespace)];
}

function resourceSecret(row: ResourceProjectionRow): KubeManifest {
  const manifest: KubeManifest = projectSecretManifest({
    data: row.env,
    deploymentId: row.resourceId,
    namespaceId: row.namespaceId,
    secretId: row.secretId,
  });
  return {
    ...manifest,
    metadata: {
      ...manifest.metadata,
      labels: { ...manifest.metadata?.labels, 'compartment.dev/resource-id': row.resourceId },
    },
  };
}

function resourceDeployment(
  row: ResourceProjectionRow,
  replicas: 0 | 1,
  labels: Record<string, string>,
  name: string,
  namespace: string,
): KubeDeploymentManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { labels, name, namespace },
    spec: {
      progressDeadlineSeconds: resourceProgressDeadlineSeconds(row),
      replicas,
      selector: { matchLabels: labels },
      strategy: { type: 'Recreate' },
      template: resourcePodTemplate(row, labels),
    },
  };
}

function resourcePodTemplate(row: ResourceProjectionRow, labels: Record<string, string>): KubePodTemplate {
  return {
    metadata: { annotations: { 'compartment.dev/secret-checksum': secretChecksum(row.env) }, labels },
    spec: {
      automountServiceAccountToken: false,
      containers: [resourceContainer(row)],
      terminationGracePeriodSeconds: 60,
      volumes: row.volumes.map(
        (volume: ResourceVolumeProjection): KubePodVolume => ({
          name: kubeResourceVolumeName(row.resourceId, volume.volumeHandle),
          persistentVolumeClaim: { claimName: kubeResourceVolumeName(row.resourceId, volume.volumeHandle) },
        }),
      ),
    },
  };
}

function resourceContainer(row: ResourceProjectionRow): KubeProjectedContainer {
  return {
    ...(row.command.length === 0 ? {} : { args: row.command }),
    env: secretEnvironment(row.env, kubeSecretName(row.secretId)),
    image: row.image,
    name: 'resource',
    ...(row.ports.length === 0 ? {} : { ports: row.ports.map(resourceContainerPort) }),
    ...(row.readiness === null ? {} : { readinessProbe: resourceReadinessProbe(row.readiness.port) }),
    volumeMounts: row.volumes.map(
      (volume: ResourceVolumeProjection): KubeVolumeMount => ({
        mountPath: volume.mountPath,
        name: kubeResourceVolumeName(row.resourceId, volume.volumeHandle),
      }),
    ),
  };
}

function resourceReadinessProbe(port: number): KubeReadinessProbe {
  return {
    failureThreshold: 3,
    periodSeconds: 2,
    successThreshold: 1,
    tcpSocket: { port },
    timeoutSeconds: 1,
  };
}

function resourceContainerPort(port: number): KubeContainerPort {
  return { containerPort: port, name: resourcePortName(port), protocol: 'TCP' };
}

function resourceProgressDeadlineSeconds(row: ResourceProjectionRow): number {
  return row.readiness === null ? 90 : Math.ceil(row.readiness.timeoutMs / 1_000);
}

function resourceService(
  row: ResourceProjectionRow,
  labels: Record<string, string>,
  name: string,
  namespace: string,
): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { labels, name, namespace },
    spec: {
      clusterIP: 'None',
      ports: row.ports.map(
        (port: number): KubeServicePort => ({
          name: resourcePortName(port),
          port,
          protocol: 'TCP',
          targetPort: port,
        }),
      ),
      selector: labels,
    },
  };
}

function resourcePortName(port: number): string {
  return `tcp-${port}`;
}

export function projectResourceClaimDeleteTargets(
  row: ResourceProjectionRow,
  observed: readonly ObservedResourceClaim[],
): KubeManifest[] {
  const claimsByName: Map<string, KubeManifest> = new Map<string, KubeManifest>(
    projectResourceBootstrapClaims(row).map((claim: KubeManifest): [string, KubeManifest] => [
      claim.metadata?.name ?? '',
      claim,
    ]),
  );
  return observed.map((identity: ObservedResourceClaim): KubeManifest => {
    const claim: KubeManifest | undefined = claimsByName.get(identity.claimName);
    if (claim === undefined || identity.uid === null || identity.resourceVersion === null) {
      throw new Error(`Resource reconcile refused: expected PVC ${identity.claimName} identity is missing.`);
    }
    return {
      ...claim,
      metadata: { ...claim.metadata, resourceVersion: identity.resourceVersion, uid: identity.uid },
    };
  });
}

/** Explicit bootstrap-only PVC projection. Never add this result to projectResourceManifests. */
export function projectResourceBootstrapClaims(row: ResourceProjectionRow): KubeManifest[] {
  return [...row.volumes, { mountPath: '/backup', size: '1Gi', volumeHandle: resourceBackupVolumeHandle }].map(
    (volume: ResourceVolumeProjection): KubeManifest => ({
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        labels: { ...managedByLabel, 'compartment.dev/resource-id': row.resourceId },
        name: kubeResourceVolumeName(row.resourceId, volume.volumeHandle),
        namespace: kubeNamespaceName(row.namespaceId),
      },
      spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: volume.size } } },
    }),
  );
}

export function assertResourceClaimIdentity(
  expected: readonly ExpectedResourceClaim[],
  observed: readonly ObservedResourceClaim[],
): void {
  assertResourceClaimOwnership(expected, observed);
  for (const claim of expected) {
    const actual: ObservedResourceClaim | undefined = observed.find(
      (candidate: ObservedResourceClaim): boolean => candidate.claimName === claim.claimName,
    );
    if (actual?.bound !== true) {
      throw new Error(`Resource reconcile refused: PVC ${claim.claimName} is missing or unbound.`);
    }
  }
}

export function assertResourceClaimOwnership(
  expected: readonly ExpectedResourceClaim[],
  observed: readonly ObservedResourceClaim[],
): void {
  if (expected.length === 0) {
    throw new Error('Resource reconcile refused: expected PVC identity is missing. Bootstrap is required.');
  }
  for (const claim of expected) {
    const actual: ObservedResourceClaim | undefined = observed.find(
      (candidate: ObservedResourceClaim): boolean => candidate.claimName === claim.claimName,
    );
    const actualUid: string | null | undefined = actual?.uid;
    if (actualUid === undefined || actualUid === null) {
      throw new Error(`Resource reconcile refused: PVC ${claim.claimName} is missing.`);
    }
    if (actualUid !== claim.uid) {
      throw new Error(`Resource reconcile refused: PVC ${claim.claimName} UID changed.`);
    }
  }
  if (observed.length !== expected.length) {
    throw new Error('Resource reconcile refused: PVC handle mapping changed.');
  }
}

export function resourcePodsFullyTerminated(pods: readonly { deletionTimestamp?: string | undefined }[]): boolean {
  return pods.length === 0;
}
