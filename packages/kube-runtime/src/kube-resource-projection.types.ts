export interface ResourceProjectionRow {
  command: string[];
  deleteData: boolean;
  environmentId: string;
  env: Readonly<Record<string, string>>;
  image: string;
  namespaceId: string;
  operation: 'delete' | 'reconcile';
  ports: number[];
  readiness: ResourceReadinessProjection | null;
  replicas: 0 | 1;
  resourceId: string;
  secretId: string;
  volumes: ResourceVolumeProjection[];
}

export interface ResourceReadinessProjection {
  port: number;
  timeoutMs: number;
  type: 'tcp';
}

export interface ResourceVolumeProjection {
  mountPath: string;
  size: string;
  volumeHandle: string;
}

export interface ResourceContainerInvocation {
  args?: string[] | undefined;
  command?: string[] | undefined;
}

export interface ObservedResourceClaim {
  bound: boolean;
  claimName: string;
  resourceVersion: string | null;
  uid: string | null;
}

export interface ExpectedResourceClaim {
  claimName: string;
  uid: string;
}
