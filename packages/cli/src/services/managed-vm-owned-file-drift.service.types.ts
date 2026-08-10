export type ManagedVmOwnedPathDriftKind = 'changed' | 'missing' | 'unexpected';

export interface ManagedVmOwnedPathDrift {
  detail: string;
  kind: ManagedVmOwnedPathDriftKind;
  path: string;
}

export interface ManagedVmOwnedPathIdentity {
  digest?: string | undefined;
  gid?: string | undefined;
  kind: string;
  mode?: string | undefined;
  uid?: string | undefined;
}
