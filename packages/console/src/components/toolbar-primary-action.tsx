import type { AnchorHTMLAttributes, ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { cn } from '../lib/utils';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { buttonVariants } from './ui/button';
import { type LucideIcon } from './ui/icons';

interface ToolbarPrimaryActionSharedProps {
  children: ReactNode;
  className?: string | undefined;
  icon: LucideIcon;
}

interface ToolbarPrimaryActionLinkProps
  extends
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'>,
    ToolbarPrimaryActionSharedProps {
  href: string;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

interface ToolbarPrimaryActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>, ToolbarPrimaryActionSharedProps {}

export function ToolbarPrimaryActionLink({
  children,
  className,
  href,
  icon,
  onNavigate,
  ...props
}: Readonly<ToolbarPrimaryActionLinkProps>): JSX.Element {
  return (
    <BrowserSoftNavigationLink
      className={readToolbarPrimaryActionClassName(className)}
      href={href}
      onNavigate={onNavigate}
      {...props}
    >
      <ToolbarPrimaryActionContent icon={icon}>{children}</ToolbarPrimaryActionContent>
    </BrowserSoftNavigationLink>
  );
}

export function ToolbarPrimaryActionButton({
  children,
  className,
  icon,
  ...props
}: Readonly<ToolbarPrimaryActionButtonProps>): JSX.Element {
  return (
    <button className={readToolbarPrimaryActionClassName(className)} {...props}>
      <ToolbarPrimaryActionContent icon={icon}>{children}</ToolbarPrimaryActionContent>
    </button>
  );
}

function ToolbarPrimaryActionContent({
  children,
  icon: Icon,
}: Readonly<Pick<ToolbarPrimaryActionSharedProps, 'children' | 'icon'>>): JSX.Element {
  return (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{children}</span>
    </>
  );
}

function readToolbarPrimaryActionClassName(className?: string): string {
  return buttonVariants({
    className: cn('justify-center no-underline', className),
    variant: 'default',
  });
}
