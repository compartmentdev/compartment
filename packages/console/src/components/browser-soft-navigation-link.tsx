import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ForwardedRef,
  type ForwardRefExoticComponent,
  type JSX,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  type RefAttributes,
} from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';

type BrowserSoftNavigationClickHandler = MouseEventHandler<HTMLAnchorElement> | undefined;

interface BrowserSoftNavigationLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  href: string;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

interface BrowserSoftNavigationClickInput {
  event: MouseEvent<HTMLAnchorElement>;
  href: string;
  onClick: BrowserSoftNavigationClickHandler;
  onNavigate: BrowserSoftNavigateHandler | undefined;
}

export const BrowserSoftNavigationLink: ForwardRefExoticComponent<
  BrowserSoftNavigationLinkProps & RefAttributes<HTMLAnchorElement>
> = forwardRef<HTMLAnchorElement, BrowserSoftNavigationLinkProps>(function BrowserSoftNavigationLink(
  { children, href, onClick, onNavigate, ...props }: Readonly<BrowserSoftNavigationLinkProps>,
  ref: ForwardedRef<HTMLAnchorElement>,
): JSX.Element {
  return (
    <a
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
        handleBrowserSoftNavigationClick({ event, href, onClick, onNavigate });
      }}
      ref={ref}
      {...props}
    >
      {children}
    </a>
  );
});

function handleBrowserSoftNavigationClick(input: Readonly<BrowserSoftNavigationClickInput>): void {
  input.onClick?.(input.event);
  if (shouldUseNativeNavigation(input)) {
    return;
  }

  input.event.preventDefault();
  input.onNavigate?.(input.href);
}

function shouldUseNativeNavigation(input: Readonly<BrowserSoftNavigationClickInput>): boolean {
  return (
    input.event.defaultPrevented ||
    input.onNavigate === undefined ||
    input.event.button !== 0 ||
    input.event.metaKey ||
    input.event.altKey ||
    input.event.ctrlKey ||
    input.event.shiftKey ||
    shouldUseTargetNavigation(input.event.currentTarget.target)
  );
}

function shouldUseTargetNavigation(target: string): boolean {
  return target !== '' && target !== '_self';
}
