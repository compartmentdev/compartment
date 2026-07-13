export interface KubeVolumeMount {
  mountPath: string;
  name: string;
  readOnly?: boolean | undefined;
  subPath?: string | undefined;
}

export interface KubePodVolume {
  emptyDir?: Record<string, never> | undefined;
  name: string;
  persistentVolumeClaim?: { claimName: string; readOnly?: boolean | undefined } | undefined;
  secret?: { secretName: string } | undefined;
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
