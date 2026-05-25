import { useEffect } from 'react';
import {
  QueryClient,
  type MutationKey,
  type QueryKey,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { BrowserApiRequestOptions } from './browser-api';

export interface BrowserQueryFunctionContext {
  signal: AbortSignal;
}

interface BrowserQueryDataOptions<TData> {
  options?: BrowserApiRequestOptions | undefined;
  queryKey: QueryKey;
  request: BrowserQueryDataRequest<TData>;
  staleTime?: number | undefined;
}

interface BrowserMutationOptions<TData, TVariables> {
  mutation: BrowserMutationRequest<TData, TVariables>;
  mutationKey: MutationKey;
  onError?: ((error: Error, variables: TVariables) => void) | undefined;
  onSuccess?: ((data: TData, variables: TVariables) => Promise<void> | void) | undefined;
}

type BrowserQueryDataRequest<TData> = (options: BrowserApiRequestOptions) => Promise<TData>;
type BrowserMutationRequest<TData, TVariables> = (variables: TVariables) => Promise<TData>;

export const browserQueryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

export async function loadBrowserQueryData<TData>({
  options = {},
  queryKey,
  request,
  staleTime,
}: BrowserQueryDataOptions<TData>): Promise<TData> {
  return await browserQueryClient.fetchQuery({
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<TData> =>
      await request({ signal: options.signal ?? signal }),
    queryKey,
    ...(staleTime === undefined ? {} : { staleTime }),
  });
}

export function useBrowserMutation<TData, TVariables = void>({
  mutation,
  mutationKey,
  onError,
  onSuccess,
}: BrowserMutationOptions<TData, TVariables>): UseMutationResult<TData, Error, TVariables> {
  return useMutation<TData, Error, TVariables>(
    {
      mutationFn: mutation,
      mutationKey,
      retry: false,
      ...(onError === undefined ? {} : { onError }),
      ...(onSuccess === undefined ? {} : { onSuccess }),
    },
    browserQueryClient,
  );
}

export function useSeedBrowserQueryData<TData>(queryKey: QueryKey, data: TData): void {
  const queryClient: QueryClient = useQueryClient();

  useEffect((): void => {
    queryClient.setQueryData(queryKey, data);
  }, [data, queryClient, queryKey]);
}

export async function invalidateBrowserQueries(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  await queryClient.invalidateQueries({ queryKey }, { throwOnError: true });
}
