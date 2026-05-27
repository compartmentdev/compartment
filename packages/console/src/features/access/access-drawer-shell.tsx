import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { cn } from '../../lib/utils';
import { AccessDrawerHeader } from './access-drawer-header';

interface AccessDrawerShellProps {
  actions?: ReactNode;
  children: ReactNode;
  closeHref: string;
  eyebrow?: string | undefined;
  footer?: ReactNode;
  header?: ReactNode;
  onNavigate: BrowserSoftNavigateHandler;
  panelClassName?: string | undefined;
  subtitle?: string | undefined;
  title: string;
}

interface AccessDrawerPanelProps {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow?: string | undefined;
  footer?: ReactNode;
  header?: ReactNode;
  isClosing: boolean;
  onClose: () => void;
  panelClassName?: string | undefined;
  subtitle?: string | undefined;
  title: string;
}

interface AccessDrawerPanelHeaderProps {
  actions?: ReactNode;
  eyebrow?: string | undefined;
  header?: ReactNode;
  onClose: () => void;
  subtitle?: string | undefined;
  title: string;
}

interface DrawerCloseAnimationState {
  isClosing: boolean;
  onClose: () => void;
}

interface DrawerCloseControlProps {
  onClose: () => void;
}

interface DrawerContentProps {
  children: ReactNode;
}

const AccessDrawerCloseContext: React.Context<(() => void) | null> = createContext<(() => void) | null>(null);

class DrawerCloseAnimationStateValue implements DrawerCloseAnimationState {
  constructor(
    readonly isClosing: boolean,
    readonly onClose: () => void,
  ) {}
}

export function AccessDrawerShell({ closeHref, onNavigate, ...props }: Readonly<AccessDrawerShellProps>): JSX.Element {
  const { isClosing, onClose }: DrawerCloseAnimationState = useDrawerCloseAnimation(closeHref, onNavigate);

  return (
    <div className={readDrawerOverlayClassName(isClosing)}>
      <AccessDrawerBackdrop onClose={onClose} />
      <AccessDrawerCloseContext.Provider value={onClose}>
        <AccessDrawerPanel isClosing={isClosing} onClose={onClose} {...props} />
      </AccessDrawerCloseContext.Provider>
    </div>
  );
}

export function useAccessDrawerCloseNavigation(closeHref: string, onNavigate: BrowserSoftNavigateHandler): () => void {
  const onClose: (() => void) | null = useContext(AccessDrawerCloseContext);

  return (): void => {
    if (onClose === null) {
      onNavigate(closeHref);
      return;
    }

    onClose();
  };
}

function useDrawerCloseAnimation(closeHref: string, onNavigate: BrowserSoftNavigateHandler): DrawerCloseAnimationState {
  const [isClosing, setIsClosing] = useState<boolean>(false);
  useDrawerEscapeClose(isClosing, setIsClosing);

  useEffect((): (() => void) | void => {
    if (!isClosing) {
      return undefined;
    }

    const timeoutId: number = window.setTimeout((): void => {
      onNavigate(closeHref);
    }, 200);

    return (): void => {
      window.clearTimeout(timeoutId);
    };
  }, [closeHref, isClosing, onNavigate]);

  return new DrawerCloseAnimationStateValue(isClosing, (): void => {
    setIsClosing(true);
  });
}

function useDrawerEscapeClose(isClosing: boolean, setIsClosing: (value: boolean) => void): void {
  useEffect((): (() => void) | void => {
    if (isClosing) {
      return undefined;
    }

    const handleKeyDown: (event: KeyboardEvent) => void = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.key !== 'Escape') {
        return;
      }

      setIsClosing(true);
    };

    window.addEventListener('keydown', handleKeyDown);

    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isClosing, setIsClosing]);
}

function AccessDrawerPanel(props: Readonly<AccessDrawerPanelProps>): JSX.Element {
  const { children, footer, isClosing, panelClassName } = props;

  return (
    <aside className={readDrawerPanelClassName(isClosing, panelClassName)}>
      <AccessDrawerPanelHeader {...props} />
      <AccessDrawerBody>{children}</AccessDrawerBody>
      {footer === undefined ? null : <div className="border-t border-border px-4 py-4">{footer}</div>}
    </aside>
  );
}

function AccessDrawerPanelHeader({
  actions,
  eyebrow,
  header,
  onClose,
  subtitle,
  title,
}: Readonly<AccessDrawerPanelHeaderProps>): JSX.Element {
  return (
    <div className="border-b border-border">
      {header ?? (
        <AccessDrawerHeader actions={actions} eyebrow={eyebrow} onClose={onClose} subtitle={subtitle} title={title} />
      )}
    </div>
  );
}

function AccessDrawerBody({ children }: Readonly<DrawerContentProps>): JSX.Element {
  return <div className="flex-1 overflow-y-auto px-4 py-0">{children}</div>;
}

function AccessDrawerBackdrop({ onClose }: Readonly<DrawerCloseControlProps>): JSX.Element {
  return (
    <button
      aria-label="Close panel"
      className="min-h-full flex-1 cursor-default"
      onClick={(): void => {
        onClose();
      }}
      type="button"
    />
  );
}

function readDrawerOverlayClassName(isClosing: boolean): string {
  return cn(
    'fixed inset-0 z-40 flex justify-end bg-[rgba(18,20,23,0.12)] backdrop-blur-[12px]',
    isClosing
      ? 'animate-out fade-out-0 duration-200 [animation-fill-mode:forwards]'
      : 'animate-in fade-in-0 duration-200',
  );
}

function readDrawerPanelClassName(isClosing: boolean, panelClassName: string | undefined): string {
  return cn(
    'flex h-full w-full flex-col overflow-hidden border-l border-border bg-popover shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] md:w-[46vw] md:max-w-none',
    isClosing
      ? 'animate-out slide-out-to-right-full duration-200 [animation-fill-mode:forwards]'
      : 'animate-in slide-in-from-right-full duration-200',
    panelClassName,
  );
}
