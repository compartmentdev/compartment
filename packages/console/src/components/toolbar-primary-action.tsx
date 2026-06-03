import type { AnchorHTMLAttributes, ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { cn } from '../lib/utils';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { buttonVariants, type ButtonVariant } from './ui/button';
import { type LucideIcon } from './ui/icons';

interface ToolbarPrimaryActionSharedProps {
  children: ReactNode;
  className?: string | undefined;
  icon: LucideIcon;
  variant?: ButtonVariant | undefined;
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
  variant,
  ...props
}: Readonly<ToolbarPrimaryActionLinkProps>): JSX.Element {
  return (
    <BrowserSoftNavigationLink
      className={readToolbarPrimaryActionClassName(className, variant)}
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
  variant,
  ...props
}: Readonly<ToolbarPrimaryActionButtonProps>): JSX.Element {
  return (
    <button className={readToolbarPrimaryActionClassName(className, variant)} {...props}>
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

function readToolbarPrimaryActionClassName(className: string | undefined, variant: ButtonVariant = 'default'): string {
  return buttonVariants({
    className: cn('justify-center no-underline', className),
    size: 'sm',
    variant,
  });
}
