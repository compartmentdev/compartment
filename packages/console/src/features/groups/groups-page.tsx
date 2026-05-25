import type { JSX } from 'react';
import { useLoaderData, useNavigate, type LoaderFunctionArgs, type NavigateFunction } from 'react-router';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import { loadGroupsPageData } from './groups-loader';
import { GroupsPageContent } from './groups-page.sections';
import { type GroupsPageState, useGroupsPageState } from './groups-page.state';
import { useGroupsPageQueryData } from './groups-query-state';

export async function loadGroupsPage(args: LoaderFunctionArgs): Promise<BrowserGroupsPageResult> {
  return await loadGroupsPageData(args);
}

export function GroupsPage(): JSX.Element {
  const loaderData: BrowserGroupsPageResult = useLoaderData();
  const queryData: BrowserGroupsPageResult = useGroupsPageQueryData(loaderData);
  const navigate: NavigateFunction = useNavigate();
  const state: GroupsPageState = useGroupsPageState(queryData, navigate);

  return <GroupsPageContent state={state} />;
}
