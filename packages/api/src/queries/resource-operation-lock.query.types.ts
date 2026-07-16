export interface ResourceOperationLock {
  release(): Promise<void>;
}

export interface ResourceOperationTryLockRow {
  acquired: boolean;
}

export interface ResourceOperationUnlockRow {
  unlocked: boolean;
}
