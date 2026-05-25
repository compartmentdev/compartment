import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { redirectBrowserWindow } from '../../lib/browser-redirect';

interface BrowserPageErrorState {
  errorMessage?: string | undefined;
}

export type BrowserPageStateSetter<T> = Dispatch<SetStateAction<T>>;

export function useBrowserPageData<T>(loaderData: T): [T, BrowserPageStateSetter<T>] {
  const [data, setData] = useState<T>(loaderData);

  useEffect((): void => {
    setData(loaderData);
  }, [loaderData]);

  return [data, setData];
}

export function useBrowserSoftNavigateHandler(): BrowserSoftNavigateHandler {
  const navigate: NavigateFunction = useNavigate();

  return (href: string): void => {
    void navigate(href);
  };
}

export function setBrowserPageError<T extends BrowserPageErrorState>(
  setData: BrowserPageStateSetter<T>,
  error: Error,
): void {
  if (redirectBrowserWindow(error)) {
    return;
  }

  setData(
    (currentData: T): T => ({
      ...currentData,
      errorMessage: error.message,
    }),
  );
}
