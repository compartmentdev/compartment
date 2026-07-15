export interface ResourceProjectionRow {
  containerPort: number;
  deleteData: boolean;
  environmentId: string;
  env: Readonly<Record<string, string>>;
  image: string;
  namespaceId: string;
  operation: 'delete' | 'reconcile';
  replicas: 0 | 1;
  resourceId: string;
  secretId: string;
  volumes: ResourceVolumeProjection[];
}

export interface ResourceVolumeProjection {
  mountPath: string;
  size: string;
  volumeHandle: string;
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
