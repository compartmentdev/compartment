type BrowserRefreshCancellationReader = () => boolean;
type BrowserRefreshRunner = (isCancelled: BrowserRefreshCancellationReader) => Promise<void>;

export function startBrowserLiveRefresh(refresh: BrowserRefreshRunner, intervalMs: number): () => void {
  let timeoutId: number | undefined;
  let cancelled: boolean = false;

  function scheduleRefresh(): void {
    timeoutId = window.setTimeout((): void => {
      void refresh((): boolean => cancelled).finally(scheduleNextRefresh);
    }, intervalMs);
  }

  function scheduleNextRefresh(): void {
    if (!cancelled) {
      scheduleRefresh();
    }
  }

  scheduleRefresh();

  return (): void => {
    cancelled = true;
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  };
}
