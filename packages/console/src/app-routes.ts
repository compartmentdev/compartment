import type { ComponentType } from 'react';
import { Outlet, type LoaderFunction, type RouteObject, type ShouldRevalidateFunction } from 'react-router';
import {
  browserOrganizationAuditPathnameTemplate,
  browserOrganizationGroupsPathnameTemplate,
  browserOrganizationOnboardingPathnameTemplate,
  browserOrganizationProjectCreatePathnameTemplate,
  browserOrganizationProjectDeploymentDetailsPathnameTemplate,
  browserOrganizationProjectDeploymentsPathnameTemplate,
  browserOrganizationProjectOverviewPathnameTemplate,
  browserOrganizationProjectsPathnameTemplate,
  browserOrganizationRolesPathnameTemplate,
  browserOrganizationUsersPathnameTemplate,
  browserProjectCreatePathname,
} from './browser-public-paths';
import { BrowserRouteErrorBoundary } from './features/console/browser-route-error-page';
import {
  BrowserConsoleShellRouteBoundary,
  browserConsoleShellRouteId,
  loadBrowserConsoleShellRouteData,
} from './features/console/console-shell-route';
import { shouldRevalidateBrowserConsoleShellRoute } from './features/console/console-shell-route.navigation';

interface ConsoleLazyRouteResult {
  Component: ComponentType;
  loader: LoaderFunction;
  shouldRevalidate?: ShouldRevalidateFunction;
}

type ConsoleLazyRoute = () => Promise<ConsoleLazyRouteResult>;

const loadDeploymentHistoryRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { DeploymentHistoryPage, loadDeploymentHistoryPage } =
    await import('./features/deployment-history/deployment-history-page');
  return { Component: DeploymentHistoryPage, loader: loadDeploymentHistoryPage };
};

const loadDeploymentDetailsRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { DeploymentDetailsPage, loadDeploymentDetailsPage } =
    await import('./features/deployment-history/deployment-details-page');
  return { Component: DeploymentDetailsPage, loader: loadDeploymentDetailsPage };
};

const loadGroupsRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { GroupsPage, loadGroupsPage } = await import('./features/groups/groups-page');
  return { Component: GroupsPage, loader: loadGroupsPage };
};

const loadAuditEventsRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { AuditEventsPage, loadAuditEventsPage } = await import('./features/audit-events/audit-events-page');
  return { Component: AuditEventsPage, loader: loadAuditEventsPage };
};

const loadOnboardingRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { OnboardingPage, loadOnboardingPage } = await import('./features/onboarding/onboarding-page');
  return { Component: OnboardingPage, loader: loadOnboardingPage };
};

const loadProjectOverviewRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { ProjectOverviewPage, loadProjectOverviewPage } = await import('./features/projects/project-overview-page');
  return { Component: ProjectOverviewPage, loader: loadProjectOverviewPage };
};

const loadProjectCreateRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { ProjectCreatePage, loadProjectCreatePage } = await import('./features/onboarding/project-create-page');
  return { Component: ProjectCreatePage, loader: loadProjectCreatePage };
};

const loadProjectsRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { ProjectsPage, loadProjectsPage } = await import('./features/projects/projects-page');
  return { Component: ProjectsPage, loader: loadProjectsPage };
};

const loadRolesRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { RolesPage, loadRolesPage, shouldRevalidateRolesPage } = await import('./features/roles/roles-page');
  return { Component: RolesPage, loader: loadRolesPage, shouldRevalidate: shouldRevalidateRolesPage };
};

const loadUsersRoute: ConsoleLazyRoute = async (): Promise<ConsoleLazyRouteResult> => {
  const { UsersPage, loadUsersPage } = await import('./features/users/users-page');
  return { Component: UsersPage, loader: loadUsersPage };
};

export const appRoutes: RouteObject[] = [
  {
    Component: Outlet,
    ErrorBoundary: BrowserRouteErrorBoundary,
    children: [
      {
        Component: BrowserConsoleShellRouteBoundary,
        id: browserConsoleShellRouteId,
        loader: loadBrowserConsoleShellRouteData,
        shouldRevalidate: shouldRevalidateBrowserConsoleShellRoute,
        children: [
          {
            index: true,
            lazy: loadProjectsRoute,
          },
          {
            lazy: loadDeploymentHistoryRoute,
            path: browserOrganizationProjectDeploymentsPathnameTemplate,
          },
          {
            lazy: loadDeploymentDetailsRoute,
            path: browserOrganizationProjectDeploymentDetailsPathnameTemplate,
          },
          {
            lazy: loadAuditEventsRoute,
            path: browserOrganizationAuditPathnameTemplate,
          },
          {
            lazy: loadGroupsRoute,
            path: browserOrganizationGroupsPathnameTemplate,
          },
          {
            lazy: loadProjectOverviewRoute,
            path: browserOrganizationProjectOverviewPathnameTemplate,
          },
          {
            lazy: loadProjectCreateRoute,
            path: browserOrganizationProjectCreatePathnameTemplate,
          },
          {
            lazy: loadProjectsRoute,
            path: browserOrganizationProjectsPathnameTemplate,
          },
          {
            lazy: loadRolesRoute,
            path: browserOrganizationRolesPathnameTemplate,
          },
          {
            lazy: loadUsersRoute,
            path: browserOrganizationUsersPathnameTemplate,
          },
        ],
      },
      {
        lazy: loadOnboardingRoute,
        path: browserOrganizationOnboardingPathnameTemplate,
      },
      {
        lazy: loadProjectCreateRoute,
        path: browserProjectCreatePathname,
      },
    ],
  },
];
