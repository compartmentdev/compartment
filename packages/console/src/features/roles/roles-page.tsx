import { useLoaderData, useNavigate, type LoaderFunctionArgs, type NavigateFunction } from 'react-router';
import type { JSX } from 'react';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import { loadRolesPageData } from './roles-loader';
import { RolesPageContent } from './roles-page.sections';
import { type RolesPageState, useRolesPageState } from './roles-page.state';
import { useRolesPageQueryData } from './roles-query-state';

export { shouldRevalidateRolesPage } from './roles-page.navigation';

export async function loadRolesPage(args: LoaderFunctionArgs): Promise<BrowserRolesPageResult> {
  return await loadRolesPageData(args);
}

export function RolesPage(): JSX.Element {
  const loaderData: BrowserRolesPageResult = useLoaderData();
  const queryData: BrowserRolesPageResult = useRolesPageQueryData(loaderData);
  const navigate: NavigateFunction = useNavigate();
  const state: RolesPageState = useRolesPageState(queryData, navigate);

  return <RolesPageContent state={state} />;
}
