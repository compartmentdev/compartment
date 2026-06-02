import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { JSX } from 'react';
import type {
  BrowserProjectsPageResult,
  BrowserProjectsArchiveState,
} from '../../services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import {
  TabsLiftedNavigation,
  TabsLiftedTriggerContent,
  readTabsLiftedTriggerClassName,
} from '../../components/ui/tabs-lifted';
import type { TabsLiftedIconName } from '../../components/ui/tabs-lifted.types';
import { buildProjectsHref } from './projects-query';

interface ProjectArchiveStateSwitchProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectArchiveStateLinkProps {
  active: boolean;
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  tab: ProjectArchiveStateTab;
}

interface ProjectArchiveStateTab {
  icon: TabsLiftedIconName;
  label: string;
  value: BrowserProjectsArchiveState;
  widthClassName: string;
}

const projectArchiveStateTabs: readonly ProjectArchiveStateTab[] = [
  {
    icon: 'active',
    label: 'Active',
    value: 'active',
    widthClassName: 'w-[79px]',
  },
  {
    icon: 'archived',
    label: 'Archived',
    value: 'archived',
    widthClassName: 'w-[95px]',
  },
  {
    icon: 'all',
    label: 'All',
    value: 'all',
    widthClassName: 'w-[56px]',
  },
];
const projectArchiveStateTabValues: readonly BrowserProjectsArchiveState[] = projectArchiveStateTabs.map(
  (tab: ProjectArchiveStateTab): BrowserProjectsArchiveState => tab.value,
);

export function ProjectArchiveStateSwitch({
  data,
  onNavigate,
}: Readonly<ProjectArchiveStateSwitchProps>): JSX.Element | null {
  return renderProjectArchiveStateNavigation(data, onNavigate);
}

function renderProjectArchiveStateNavigation(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <TabsLiftedNavigation
      ariaLabel="Project state"
      className="shrink-0 pb-4"
      contentValues={projectArchiveStateTabValues}
      value={data.archiveState}
    >
      {projectArchiveStateTabs.map(
        (tab: ProjectArchiveStateTab): JSX.Element => (
          <ProjectArchiveStateLink
            active={data.archiveState === tab.value}
            data={data}
            key={tab.value}
            onNavigate={onNavigate}
            tab={tab}
          />
        ),
      )}
    </TabsLiftedNavigation>
  );
}

function ProjectArchiveStateLink({
  active,
  data,
  onNavigate,
  tab,
}: Readonly<ProjectArchiveStateLinkProps>): JSX.Element {
  const href: string = buildProjectsHref(data, {
    archiveState: tab.value,
    page: 1,
  });

  return (
    <TabsPrimitive.Trigger asChild className={readTabsLiftedTriggerClassName(tab.widthClassName)} value={tab.value}>
      <BrowserSoftNavigationLink aria-current={active ? 'page' : undefined} href={href} onNavigate={onNavigate}>
        <TabsLiftedTriggerContent icon={tab.icon} label={tab.label} />
      </BrowserSoftNavigationLink>
    </TabsPrimitive.Trigger>
  );
}
