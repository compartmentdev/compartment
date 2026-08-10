import type { KubeJobEmptyDirVolume, KubeJobSpec } from './kube-job-spec.types';
import type { KubePodVolume } from './kube-runtime.types';
import type { KubeJobVolumeMount, KubeVolumeMount } from './kube-volume.types';

export function kubeJobVolumes(spec: KubeJobSpec): KubePodVolume[] {
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
  const emptyDirectories: KubePodVolume[] =
    spec.emptyDirVolumes?.map(
      ({ name, sizeLimit }: KubeJobEmptyDirVolume): KubePodVolume => ({
        emptyDir: sizeLimit === undefined ? {} : { sizeLimit },
        name,
      }),
    ) ?? [];
  return [...persistentVolumes, ...emptyDirectories, ...(kubeApiAccess === null ? [] : [kubeApiAccess])];
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

export function kubeJobVolumeMounts(spec: KubeJobSpec): KubeVolumeMount[] {
  const mounts: KubeVolumeMount[] =
    spec.volumeMounts?.map(
      (mount: KubeJobVolumeMount): KubeVolumeMount => ({
        mountPath: mount.mountPath,
        name: mount.name,
        ...(mount.readOnly === undefined ? {} : { readOnly: mount.readOnly }),
        ...(mount.subPath === undefined ? {} : { subPath: mount.subPath }),
      }),
    ) ?? [];
  const emptyDirectoryMounts: KubeVolumeMount[] =
    spec.emptyDirVolumes?.flatMap(({ containerMountPath, name }: KubeJobEmptyDirVolume): KubeVolumeMount[] =>
      containerMountPath === undefined ? [] : [{ mountPath: containerMountPath, name }],
    ) ?? [];
  const jobMounts: KubeVolumeMount[] = [...mounts, ...emptyDirectoryMounts];
  return spec.serviceAccountTokenExpirationSeconds === undefined
    ? jobMounts
    : [
        ...jobMounts,
        { mountPath: '/var/run/secrets/kubernetes.io/serviceaccount', name: 'kube-api-access', readOnly: true },
      ];
}
