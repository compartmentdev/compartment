export interface KubeToleration {
  effect?: 'NoExecute' | 'NoSchedule' | 'PreferNoSchedule' | undefined;
  key?: string | undefined;
  operator?: 'Equal' | 'Exists' | undefined;
  tolerationSeconds?: number | undefined;
  value?: string | undefined;
}

export interface KubeWorkloadScheduling {
  nodeSelector: Readonly<Record<string, string>>;
  runtimeClassName?: string | undefined;
  tolerations: readonly KubeToleration[];
}

export interface KubeDataWorkloadScheduling extends KubeWorkloadScheduling {
  runtimeClassName: string;
}
