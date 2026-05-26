import type { JSX } from 'react';
import { cn } from '../../../lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { TabsLiftedTriggerContent, readTabsLiftedTriggerClassName } from '../../ui/tabs-lifted';
import type { TabsLiftedIconName } from '../../ui/tabs-lifted.types';

interface TabsLiftedDemoTab {
  icon: TabsLiftedIconName;
  name: string;
  value: TabsLiftedDemoTabValue;
  widthClassName: string;
}

type TabsLiftedDemoTabValue = 'active' | 'archived' | 'all';

interface TabsLiftedDemoProps {
  defaultValue?: TabsLiftedDemoTabValue;
}

const tabs: readonly TabsLiftedDemoTab[] = [
  {
    icon: 'active',
    name: 'Active',
    value: 'active',
    widthClassName: 'w-[79px]',
  },
  {
    icon: 'archived',
    name: 'Archived',
    value: 'archived',
    widthClassName: 'w-[95px]',
  },
  {
    icon: 'all',
    name: 'All',
    value: 'all',
    widthClassName: 'w-[56px]',
  },
];
const tabsLiftedDemoVariablesClassName: string = '[--tabs-lifted-bg:#fbfcfc] [--tabs-lifted-border:var(--border)]';
const tabsLiftedDemoSurfaceClassName: string =
  "relative isolate h-8 items-center justify-start rounded-none border-0 bg-transparent p-0 text-[#111212] before:absolute before:inset-x-0 before:bottom-0 before:z-0 before:h-px before:bg-[var(--tabs-lifted-border)] before:content-['']";

export default function TabsLiftedDemo({ defaultValue = 'all' }: Readonly<TabsLiftedDemoProps> = {}): JSX.Element {
  return (
    <Tabs className={cn('h-8 w-[262px] px-4', tabsLiftedDemoVariablesClassName)} defaultValue={defaultValue}>
      <TabsList className={tabsLiftedDemoSurfaceClassName}>{tabs.map(renderTabsTrigger)}</TabsList>

      {tabs.map(renderTabsContent)}
    </Tabs>
  );
}

function renderTabsTrigger(tab: TabsLiftedDemoTab): JSX.Element {
  return (
    <TabsTrigger className={readTabsLiftedTriggerClassName(tab.widthClassName)} key={tab.value} value={tab.value}>
      <TabsLiftedTriggerContent icon={tab.icon} label={tab.name} />
    </TabsTrigger>
  );
}

function renderTabsContent(tab: TabsLiftedDemoTab): JSX.Element {
  return (
    <TabsContent className="sr-only" key={tab.value} value={tab.value}>
      <p>{tab.name}</p>
    </TabsContent>
  );
}
