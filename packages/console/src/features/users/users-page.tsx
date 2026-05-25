import type { JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { UsersView } from './users-view';
import { loadUsersPageData } from './users-loader';
import type { UserActionHandler } from './user-actions';
import { setBrowserPageError, useBrowserPageData, useBrowserSoftNavigateHandler } from '../console/console-page';
import { invalidateUsersListQueries } from './users-query-invalidation';
import { useUsersPageQueryData } from './users-query-state';

export async function loadUsersPage(args: LoaderFunctionArgs): Promise<BrowserUsersPageResult> {
  return await loadUsersPageData(args);
}

export function UsersPage(): JSX.Element {
  const loaderData: BrowserUsersPageResult = useLoaderData();
  const queryData: BrowserUsersPageResult = useUsersPageQueryData(loaderData);
  const [data, setData] = useBrowserPageData(queryData);
  const onNavigate: BrowserSoftNavigateHandler = useBrowserSoftNavigateHandler();
  const onUserAction: UserActionHandler = async (actionError?: Error): Promise<void> => {
    if (actionError !== undefined) {
      setBrowserPageError(setData, actionError);
      return;
    }
    try {
      await invalidateUsersListQueries(data);
    } catch (error) {
      setBrowserPageError(setData, error instanceof Error ? error : new Error('User action failed.'));
    }
  };

  return <UsersView data={data} onNavigate={onNavigate} onUserAction={onUserAction} setData={setData} />;
}
