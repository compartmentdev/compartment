import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { JSX } from 'react';
import { cn } from '../../lib/utils';
import type {
  TabsLiftedIconDefinition,
  TabsLiftedIconName,
  TabsLiftedIconProps,
  TabsLiftedNavigationProps,
  TabsLiftedTriggerContentProps,
} from './tabs-lifted.types';

const tabsLiftedVariablesClassName: string =
  '[--tabs-lifted-bg:var(--card)] [--tabs-lifted-inactive:var(--accent)] [--tabs-lifted-foreground:var(--foreground)] [--tabs-lifted-muted:var(--muted-foreground-secondary)]';
const tabsLiftedSurfaceClassName: string =
  'inline-flex h-9 w-fit items-center justify-start gap-1 rounded-field border-0 bg-[var(--tabs-lifted-inactive)] p-1 text-[var(--tabs-lifted-muted)]';

const tabsLiftedIcons: Readonly<Record<TabsLiftedIconName, TabsLiftedIconDefinition>> = {
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

export function TabsLiftedNavigation({
  ariaLabel,
  children,
  className,
  contentValues = [],
  value,
}: Readonly<TabsLiftedNavigationProps>): JSX.Element {
  return (
    <TabsPrimitive.Root
      className={cn(tabsLiftedVariablesClassName, 'w-fit', className)}
      {...(value === undefined ? {} : { value })}
    >
      <TabsPrimitive.List aria-label={ariaLabel} className={tabsLiftedSurfaceClassName}>
        {children}
      </TabsPrimitive.List>
      {contentValues.map(renderTabsLiftedContent)}
    </TabsPrimitive.Root>
  );
}

function renderTabsLiftedContent(value: string): JSX.Element {
  return <TabsPrimitive.Content className="sr-only" key={value} value={value} />;
}

export function TabsLiftedTriggerContent({ icon, label }: Readonly<TabsLiftedTriggerContentProps>): JSX.Element {
  return (
    <>
      {icon === undefined ? null : <TabsLiftedIcon name={icon} />}
      <span
        className="opacity-90 transition-opacity duration-200 ease-out group-data-[state=active]:opacity-100 motion-reduce:transition-none"
        style={{ fontVariationSettings: "'opsz' 14" }}
      >
        {label}
      </span>
    </>
  );
}

export function readTabsLiftedTriggerClassName(widthClassName: string): string {
  return cn(
    widthClassName,
    'group inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-control border-0 bg-transparent px-2.5 py-1 text-[13px] font-medium leading-5 tracking-normal text-[var(--tabs-lifted-muted)] no-underline shadow-none transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none',
    'data-[state=active]:bg-[var(--tabs-lifted-bg)] data-[state=active]:text-[var(--tabs-lifted-foreground)] data-[state=active]:shadow-sm',
    'hover:text-foreground',
  );
}

function TabsLiftedIcon({ name }: Readonly<TabsLiftedIconProps>): JSX.Element {
  const icon: TabsLiftedIconDefinition = tabsLiftedIcons[name];

  return (
    <span className="relative size-4 shrink-0 overflow-hidden opacity-90 transition-opacity duration-200 ease-out group-data-[state=active]:opacity-100 motion-reduce:transition-none">
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
