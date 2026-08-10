export interface ManagedVmOwnedPathDrift {
  detail: string;
  path: string;
}

export interface ManagedVmOwnedPathIdentity {
  digest?: string | undefined;
  gid?: string | undefined;
  kind: 'directory' | 'file';
  mode?: string | undefined;
  uid?: string | undefined;
}
