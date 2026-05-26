import type { LucideIcon } from './ui/icons';

export type BrowserConsoleDetailIconTone = 'blue' | 'purple';

export interface BrowserConsoleDetailTitleProps {
  badgeLabel?: string | undefined;
  icon: LucideIcon;
  iconTone: BrowserConsoleDetailIconTone;
  title: string;
}
