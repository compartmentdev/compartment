import type {
  KubeJobManifest,
  KubeJobManifestSpec,
  KubeJobSpec,
  KubeJobVolumeMount,
  KubeManifest,
  KubePodVolume,
  KubeProjectedContainer,
  KubeProjectedPodSpec,
  KubeSecretEnvVariable,
  KubeVolumeMount,
} from './kube-runtime.types';
import { compareKubeKey } from './kube-key-order';
import { kubeSecretName } from './kube-naming';
import { secretChecksum } from './kube-secret-projection';
import type { KubePodSecurityContext } from './kube-security-context.types';
import {
  projectPodSecurityContext,
  projectVolumeSecurityContext,
  resourcePodSecurityContext,
  restrictedContainerSecurityContext,
} from './kube-security-context';

export function kubeFinalizedJobManifest(
  spec: KubeJobSpec,
  jobName: string,
  labels: Record<string, string>,
): KubeJobManifest {
  const manifest: KubeJobManifest = kubeJobManifest(spec, jobName, labels);
  return { ...manifest, spec: { ...jobSpec(spec, labels), ttlSecondsAfterFinished: 300 } };
}

export function kubeJobManifest(spec: KubeJobSpec, jobName: string, labels: Record<string, string>): KubeJobManifest {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { labels, name: jobName, namespace: spec.namespace },
    spec: jobSpec(spec, labels),
  };
}

export function kubeJobSecretManifest(spec: KubeJobSpec, labels: Record<string, string>): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { labels, name: kubeSecretName(spec.id), namespace: spec.namespace },
    stringData: spec.env,
    type: 'Opaque',
  };
}

function jobSpec(spec: KubeJobSpec, labels: Record<string, string>): KubeJobManifestSpec {
  const podSpec: KubeProjectedPodSpec = {
    automountServiceAccountToken: false,
    containers: [jobContainer(spec)],
    imagePullSecrets:
      spec.imagePullSecretId === undefined ? undefined : [{ name: kubeSecretName(spec.imagePullSecretId) }],
    restartPolicy: 'Never',
    securityContext: jobPodSecurityContext(spec),
    serviceAccountName: spec.serviceAccountName,
    volumes: kubeJobVolumes(spec),
  };
  return {
    activeDeadlineSeconds: Math.max(1, Math.ceil(spec.timeoutMs / 1_000)),
    backoffLimit: spec.jobClass === 'release' ? 0 : 1,
    template: {
      metadata: { annotations: { 'compartment.dev/secret-checksum': secretChecksum(spec.env) }, labels },
      spec: podSpec,
    },
  };
}

function jobPodSecurityContext(spec: KubeJobSpec): KubePodSecurityContext | undefined {
  const volumeGroupContext: KubePodSecurityContext =
    spec.volumeMounts === undefined || spec.volumeMounts.length === 0 ? {} : projectVolumeSecurityContext();
  if (spec.securityProfile === 'restricted') {
    return { ...volumeGroupContext, ...projectPodSecurityContext() };
  }
  if (spec.securityProfile === 'project-restricted') {
    return { ...volumeGroupContext, ...projectPodSecurityContext() };
  }
  if (spec.securityProfile === 'resource-restricted') {
    return { ...volumeGroupContext, ...resourcePodSecurityContext(spec.image) };
  }
  return Object.keys(volumeGroupContext).length === 0 ? undefined : volumeGroupContext;
}

function jobContainer(spec: KubeJobSpec): KubeProjectedContainer {
  const env: KubeSecretEnvVariable[] = Object.keys(spec.env)
    .sort(compareKubeKey)
    .map(
      (name: string): KubeSecretEnvVariable => ({
        name,
        valueFrom: { secretKeyRef: { key: name, name: kubeSecretName(spec.id) } },
      }),
    );
  return {
    args: spec.args,
    command: spec.command,
    env,
    image: spec.image,
    name: 'job',
    securityContext:
      spec.securityProfile === 'restricted' ||
      spec.securityProfile === 'project-restricted' ||
      spec.securityProfile === 'resource-restricted'
        ? restrictedContainerSecurityContext()
        : undefined,
    volumeMounts: kubeJobVolumeMounts(spec),
  };
}

function kubeJobVolumes(spec: KubeJobSpec): KubePodVolume[] {
  const persistentVolumes: KubePodVolume[] =
    spec.volumeMounts?.map(
      (mount: KubeJobVolumeMount): KubePodVolume => ({
        name: mount.name,
        persistentVolumeClaim: {
          claimName: mount.claimName,
          ...(mount.readOnly === undefined ? {} : { readOnly: mount.readOnly }),
        },
      }),
    ) ?? [];
  const kubeApiAccess: KubePodVolume | null = kubeApiAccessVolume(spec);
  return [...persistentVolumes, ...(kubeApiAccess === null ? [] : [kubeApiAccess])];
}

function kubeApiAccessVolume(spec: KubeJobSpec): KubePodVolume | null {
  if (spec.serviceAccountTokenExpirationSeconds === undefined) {
    return null;
  }
  if (spec.serviceAccountName === undefined) {
    throw new Error('Kubernetes Job token projection requires a service account name.');
  }
  return projectedKubeApiAccessVolume(spec.serviceAccountTokenExpirationSeconds);
}

function projectedKubeApiAccessVolume(expirationSeconds: number): KubePodVolume {
  return {
    name: 'kube-api-access',
    projected: {
      defaultMode: 420,
      sources: [
        { serviceAccountToken: { expirationSeconds, path: 'token' } },
        { configMap: { items: [{ key: 'ca.crt', path: 'ca.crt' }], name: 'kube-root-ca.crt' } },
        {
          downwardAPI: {
            items: [{ fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.namespace' }, path: 'namespace' }],
          },
        },
      ],
    },
  };
}

function kubeJobVolumeMounts(spec: KubeJobSpec): KubeVolumeMount[] {
  const mounts: KubeVolumeMount[] =
    spec.volumeMounts?.map(
      (mount: KubeJobVolumeMount): KubeVolumeMount => ({
        mountPath: mount.mountPath,
        name: mount.name,
        ...(mount.readOnly === undefined ? {} : { readOnly: mount.readOnly }),
        ...(mount.subPath === undefined ? {} : { subPath: mount.subPath }),
      }),
    ) ?? [];
  return spec.serviceAccountTokenExpirationSeconds === undefined
    ? mounts
    : [
        ...mounts,
        { mountPath: '/var/run/secrets/kubernetes.io/serviceaccount', name: 'kube-api-access', readOnly: true },
      ];
}
