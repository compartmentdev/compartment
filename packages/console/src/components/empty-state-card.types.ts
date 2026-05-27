import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import type { LucideIcon } from './ui/icons';

export interface EmptyStateCardButtonAction {
  readonly icon: LucideIcon;
  readonly kind: 'button';
  readonly label: string;
  readonly onClick: () => void;
}

export interface EmptyStateCardLinkAction {
  readonly href: string;
  readonly icon: LucideIcon;
  readonly kind: 'link';
  readonly label: string;
  readonly onNavigate?: BrowserSoftNavigateHandler | undefined;
}

export type EmptyStateCardAction = EmptyStateCardButtonAction | EmptyStateCardLinkAction;
export type EmptyStateCardIcon = LucideIcon | string;

export interface EmptyStateCardProps {
  readonly action?: EmptyStateCardAction | undefined;
  readonly className?: string | undefined;
  readonly icon: EmptyStateCardIcon;
  readonly iconClassName?: string | undefined;
  readonly message: string;
}

export interface EmptyStateCardActionControlProps {
  readonly action: EmptyStateCardAction;
}
