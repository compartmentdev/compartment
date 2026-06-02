import type { ReactNode } from 'react';

export type TabsLiftedIconName = 'active' | 'archived' | 'all';

export interface TabsLiftedNavigationProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string | undefined;
  contentValues?: readonly string[] | undefined;
  value?: string | undefined;
}

export interface TabsLiftedTriggerContentProps {
  icon?: TabsLiftedIconName | undefined;
  label: string;
}

export interface TabsLiftedIconDefinition {
  path: string;
  positionClassName: string;
  viewBox: string;
}

export interface TabsLiftedIconProps {
  name: TabsLiftedIconName;
}
