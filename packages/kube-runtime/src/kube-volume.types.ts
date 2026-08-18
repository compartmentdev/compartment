export interface KubeEmptyDirVolume {
  sizeLimit?: string | undefined;
}

export interface KubeVolumeMount {
  mountPath: string;
  name: string;
  readOnly?: boolean | undefined;
  subPath?: string | undefined;
}

export interface KubePodVolume {
  configMap?: KubeConfigMapVolumeSource | undefined;
  emptyDir?: KubeEmptyDirVolume | undefined;
  image?: KubeImageVolumeSource | undefined;
  name: string;
  persistentVolumeClaim?: { claimName: string; readOnly?: boolean | undefined } | undefined;
  projected?:
    | {
        defaultMode: number;
        sources: object[];
      }
    | undefined;
  secret?: { secretName: string } | undefined;
}

export interface KubeImageVolumeSource {
  pullPolicy: 'Always' | 'IfNotPresent';
  reference: string;
}

export interface KubeConfigMapVolumeSource {
  name: string;
}

export interface KubeJobVolumeMount {
  claimName: string;
  expectedClaimUid: string;
  mountPath: string;
  name: string;
  readOnly?: boolean | undefined;
  resourceId: string;
  subPath?: string | undefined;
}
