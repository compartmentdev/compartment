interface AbortAwareDelayState {
  timer?: NodeJS.Timeout;
}

export async function waitForAbortOrTimeout(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    return;
  }
  await new Promise<void>((resolve: () => void): void => {
    const state: AbortAwareDelayState = {};
    const finish: () => void = (): void => {
      if (state.timer !== undefined) {
        clearTimeout(state.timer);
      }
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    state.timer = setTimeout(finish, durationMs);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
