export interface KubernetesRegistryMirror {
  clusterIp: string;
  host: string;
}

export interface KubernetesRegistryMirrorApplyResult {
  configChanged: boolean;
  current: boolean;
  restartError?: string | undefined;
}

export interface KubernetesRegistryServiceItem {
  metadata?: KubernetesRegistryServiceMetadata | undefined;
  spec?: KubernetesRegistryServiceSpec | undefined;
}

export interface KubernetesRegistryServiceList {
  items?: KubernetesRegistryServiceItem[] | undefined;
}

export interface KubernetesRegistryServiceMetadata {
  name?: string | undefined;
}

export interface KubernetesRegistryServiceSpec {
  clusterIP?: string | undefined;
}
