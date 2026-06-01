const runtimeNetworkLocks: Map<string, RuntimeNetworkLockState> = new Map<string, RuntimeNetworkLockState>();

interface RuntimeNetworkLockState {
  release(): void;
  readonly wait: Promise<void>;
}

class RuntimeNetworkLock implements RuntimeNetworkLockState {
  private releaseLock: () => void = (): void => undefined;

  public readonly wait: Promise<void> = new Promise<void>((resolve: () => void): void => {
    this.releaseLock = resolve;
  });

  public release(): void {
    this.releaseLock();
  }
}

export async function withRuntimeNetworkLock<TValue>(
  namespace: string,
  action: () => Promise<TValue>,
): Promise<TValue> {
  const previousLock: RuntimeNetworkLockState | undefined = runtimeNetworkLocks.get(namespace);
  const currentLock: RuntimeNetworkLockState = new RuntimeNetworkLock();
  runtimeNetworkLocks.set(namespace, currentLock);

  try {
    await previousLock?.wait;
    return await action();
  } finally {
    currentLock.release();
    if (runtimeNetworkLocks.get(namespace) === currentLock) {
      runtimeNetworkLocks.delete(namespace);
    }
  }
}
