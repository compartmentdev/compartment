import type { JSX } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { browserProjectCreatePathname } from '../../browser-public-paths';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import { BrowserConsoleShell } from '../../components/browser-console-header';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { AccessPageHeader } from '../access/access-ui';
import { useBrowserSoftNavigateHandler } from '../console/console-page';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { buildBrowserConsoleHref } from '../console/console-hrefs';
import { useBrowserConsoleShellRouteData } from '../console/console-shell-route';
import { FirstDeployHeader, type FirstDeployHeaderCopy } from './first-deploy-header';
import { FirstDeployFlow, useFirstDeployPageState, type FirstDeployFlowState } from './first-deploy-page';
import { loadFirstDeployPageData } from './first-deploy-page-loader';
import type { OnboardingPageData } from './onboarding-page-data.types';

const projectCreateHeaderCopy: FirstDeployHeaderCopy = {
  description: null,
  eyebrow: null,
  secondaryActionLabel: null,
  title: 'Create project',
};

interface ProjectCreatePageHeaderProps {
  onNavigate: BrowserSoftNavigateHandler;
  projectsHref: string;
}

export async function loadProjectCreatePage(args: LoaderFunctionArgs): Promise<OnboardingPageData> {
  return await loadFirstDeployPageData(args);
}

export function ProjectCreatePage(): JSX.Element {
  const flowState: FirstDeployFlowState = useFirstDeployPageState(browserProjectCreatePathname);
  const onNavigate: BrowserSoftNavigateHandler = useBrowserSoftNavigateHandler();
  return useBrowserConsoleShellRouteData() === null
    ? renderStandaloneProjectCreatePage(flowState)
    : renderConsoleProjectCreatePage(flowState, onNavigate);
}

function ProjectCreatePageHeader({ onNavigate, projectsHref }: Readonly<ProjectCreatePageHeaderProps>): JSX.Element {
  return (
    <header className="flex flex-col gap-3">
      <BrowserBreadcrumbs
        items={[{ href: projectsHref, label: 'Projects' }, { label: projectCreateHeaderCopy.title }]}
        onNavigate={onNavigate}
      />
      <AccessPageHeader title={projectCreateHeaderCopy.title} />
    </header>
  );
}

function renderConsoleProjectCreatePage(
  flowState: Readonly<FirstDeployFlowState>,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <BrowserConsoleShell
      organizationControl={readProjectCreateOrganizationControl(flowState.data, onNavigate)}
      onNavigate={onNavigate}
      page="projects"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5">
        <ProjectCreatePageHeader onNavigate={onNavigate} projectsHref={flowState.data.projectsHref} />
        <FirstDeployFlow {...flowState} />
      </div>
    </BrowserConsoleShell>
  );
}

function renderStandaloneProjectCreatePage(flowState: Readonly<FirstDeployFlowState>): JSX.Element {
  return (
    <main className="min-h-screen bg-[#f5f6f7] text-[#111212]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6 lg:py-8">
        <FirstDeployHeader
          copy={projectCreateHeaderCopy}
          hideBreadcrumbs={false}
          projectsHref={flowState.data.projectsHref}
        />
        <FirstDeployFlow {...flowState} />
      </div>
    </main>
  );
}

function readProjectCreateOrganizationControl(
  data: OnboardingPageData,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    data.organizations,
    data.selectedOrganizationSlug,
    data.showOrganizationSelector,
    (organizationSlug: string): void => {
      onNavigate(buildBrowserConsoleHref(browserProjectCreatePathname, organizationSlug));
    },
  );
}
