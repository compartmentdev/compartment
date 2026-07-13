export interface ResourceProjectionRow {
  containerPort: number;
  environmentId: string;
  env: Readonly<Record<string, string>>;
  image: string;
  namespaceId: string;
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
  uid: string | null;
}

export interface ExpectedResourceClaim {
  claimName: string;
  uid: string;
}
