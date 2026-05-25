import type { JSX } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';

interface TabsLiftedDemoTab {
  icon: TabsLiftedDemoIconName;
  name: string;
  value: TabsLiftedDemoTabValue;
  widthClassName: string;
}

type TabsLiftedDemoIconName = 'active' | 'archived' | 'all';
type TabsLiftedDemoTabValue = 'active' | 'archived' | 'all';

interface TabsLiftedDemoProps {
  defaultValue?: TabsLiftedDemoTabValue;
}

interface TabsLiftedDemoIcon {
  path: string;
  positionClassName: string;
  viewBox: string;
}

const tabs: readonly TabsLiftedDemoTab[] = [
  {
    icon: 'active',
    name: 'Active',
    value: 'active',
    widthClassName: 'w-[82px]',
  },
  {
    icon: 'archived',
    name: 'Archived',
    value: 'archived',
    widthClassName: 'w-[99px]',
  },
  {
    icon: 'all',
    name: 'All',
    value: 'all',
    widthClassName: 'w-[57px]',
  },
];

const tabIcons: Readonly<Record<TabsLiftedDemoIconName, TabsLiftedDemoIcon>> = {
  active: {
    path: 'M1.56333 6.75H5.75L6.08333 6.08333L7.41667 9.08333L8.75 4.41667L9.75 6.75H13.2633M12.0833 8.08333C13.0767 7.11 14.0833 5.94333 14.0833 4.41667C14.0833 3.44421 13.697 2.51158 13.0094 1.82394C12.3218 1.13631 11.3891 0.75 10.4167 0.75C9.24333 0.75 8.41667 1.08333 7.41667 2.08333C6.41667 1.08333 5.59 0.75 4.41667 0.75C3.44421 0.75 2.51158 1.13631 1.82394 1.82394C1.13631 2.51158 0.75 3.44421 0.75 4.41667C0.75 5.95 1.75 7.11667 2.75 8.08333L7.41667 12.75L12.0833 8.08333Z',
    positionClassName: 'left-[0.583px] top-[1.25px] h-[13.5px] w-[14.833px]',
    viewBox: '0 0 14.8333 13.5',
  },
  archived: {
    path: 'M2.08333 4.08333V11.4167C2.08333 11.7703 2.22381 12.1094 2.47386 12.3595C2.72391 12.6095 3.06304 12.75 3.41667 12.75H11.4167C11.7703 12.75 12.1094 12.6095 12.3595 12.3595C12.6095 12.1094 12.75 11.7703 12.75 11.4167V4.08333M6.08333 6.75H8.75M1.41667 0.75H13.4167C13.7849 0.75 14.0833 1.04848 14.0833 1.41667V3.41667C14.0833 3.78486 13.7849 4.08333 13.4167 4.08333H1.41667C1.04848 4.08333 0.75 3.78486 0.75 3.41667V1.41667C0.75 1.04848 1.04848 0.75 1.41667 0.75Z',
    positionClassName: 'left-[0.583px] top-[1.25px] h-[13.5px] w-[14.833px]',
    viewBox: '0 0 14.8333 13.5',
  },
  all: {
    path: 'M3.41667 0.75H10.0833M2.08333 3.41667H11.4167M2.08333 6.08333H11.4167C12.153 6.08333 12.75 6.68029 12.75 7.41667V12.75C12.75 13.4864 12.153 14.0833 11.4167 14.0833H2.08333C1.34695 14.0833 0.75 13.4864 0.75 12.75V7.41667C0.75 6.68029 1.34695 6.08333 2.08333 6.08333Z',
    positionClassName: 'left-[1.25px] top-[0.583px] h-[14.833px] w-[13.5px]',
    viewBox: '0 0 13.5 14.8333',
  },
};

export default function TabsLiftedDemo({ defaultValue = 'all' }: Readonly<TabsLiftedDemoProps> = {}): JSX.Element {
  return (
    <Tabs
      defaultValue={defaultValue}
      className="h-8 w-[270px] px-4 [--advanced-tabs-bg:#fbfcfc] [--advanced-tabs-border:#eef0f1]"
    >
      <TabsList className="relative isolate h-8 items-center justify-start rounded-none border-0 bg-transparent p-0 text-[#111212] before:absolute before:inset-x-0 before:bottom-0 before:z-0 before:h-px before:bg-[var(--advanced-tabs-border)] before:content-['']">
        {tabs.map(renderTabsTrigger)}
      </TabsList>

      {tabs.map(renderTabsContent)}
    </Tabs>
  );
}

function renderTabsTrigger(tab: TabsLiftedDemoTab): JSX.Element {
  return (
    <TabsTrigger
      className={`${tab.widthClassName} group relative z-10 box-border h-8 shrink-0 gap-1 rounded-b-none rounded-t-[6px] border-0 border-solid bg-transparent px-2.5 py-1.5 text-sm font-medium leading-5 tracking-normal text-[#111212] shadow-none transition-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:z-20 data-[state=active]:border-x! data-[state=active]:border-b-0! data-[state=active]:border-t! data-[state=active]:border-[var(--advanced-tabs-border)]! data-[state=active]:bg-[var(--advanced-tabs-bg)] data-[state=active]:shadow-none`}
      key={tab.value}
      value={tab.value}
    >
      <TabIcon name={tab.icon} />
      <span className="opacity-60 group-data-[state=active]:opacity-100" style={{ fontVariationSettings: "'opsz' 14" }}>
        {tab.name}
      </span>
      <TabCorner side="left" />
      <TabCorner side="right" />
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

function TabCorner({ side }: Readonly<{ side: 'left' | 'right' }>): JSX.Element {
  const positionClass: string = side === 'left' ? 'left-[-9px]' : 'right-[-9px] -scale-x-100';

  return (
    <span
      aria-hidden="true"
      className={`${positionClass} pointer-events-none absolute bottom-0 hidden size-[9px] group-data-[state=active]:block`}
    >
      <TabCornerBackground />
      <TabCornerBorder />
    </span>
  );
}

function TabIcon({ name }: Readonly<{ name: TabsLiftedDemoIconName }>): JSX.Element {
  const icon: TabsLiftedDemoIcon = tabIcons[name];

  return (
    <span className="relative size-4 shrink-0 overflow-hidden opacity-60 group-data-[state=active]:opacity-100">
      <svg
        aria-hidden="true"
        className={`absolute ${icon.positionClassName}`}
        fill="none"
        preserveAspectRatio="none"
        viewBox={icon.viewBox}
      >
        <path d={icon.path} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

function TabCornerBackground(): JSX.Element {
  return (
    <svg className="absolute inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 9 9">
      <path
        clipRule="evenodd"
        d="M9 0H8C8 4.418 4.418 8 0 8v1h9V0Z"
        fill="var(--advanced-tabs-bg)"
        fillRule="evenodd"
      />
    </svg>
  );
}

function TabCornerBorder(): JSX.Element {
  return (
    <svg className="absolute inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 9 9">
      <path d="M0 8C4.418 8 8 4.418 8 0" stroke="var(--advanced-tabs-border)" strokeLinecap="butt" strokeWidth="1" />
    </svg>
  );
}
