import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { cn } from '../../lib/utils';
import { AccessDrawerHeader } from './access-drawer-header';

interface AccessPageHeaderProps {
  action?: ReactNode;
  description?: ReactNode;
  title: string;
}
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
interface AccessDrawerSectionProps {
  actions?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  description?: ReactNode;
  separated?: boolean | undefined;
  title?: string | undefined;
}
interface AccessDrawerSummaryTextProps {
  children: ReactNode;
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

const AccessDrawerCloseContext: React.Context<(() => void) | null> = createContext<(() => void) | null>(null);

export function AccessPageHeader({ action, description, title }: Readonly<AccessPageHeaderProps>): JSX.Element {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description === undefined || description === null ? null : (
            <p className="max-w-3xl text-[13px] leading-6 text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}

export function AccessDrawerShell({ closeHref, onNavigate, ...props }: Readonly<AccessDrawerShellProps>): JSX.Element {
  const { isClosing, onClose } = useDrawerCloseAnimation(closeHref, onNavigate);

  return (
    <div className={readDrawerOverlayClassName(isClosing)}>
      <AccessDrawerBackdrop onClose={onClose} />
      <AccessDrawerCloseContext.Provider value={onClose}>
        <AccessDrawerPanel isClosing={isClosing} onClose={onClose} {...props} />
      </AccessDrawerCloseContext.Provider>
    </div>
  );
}

export function AccessDrawerSection({
  actions,
  children,
  className,
  description,
  separated = true,
  title,
}: Readonly<AccessDrawerSectionProps>): JSX.Element {
  return (
    <section className={cn('-mx-4 px-4 py-6', separated ? 'border-t border-border' : undefined, className)}>
      <AccessDrawerSectionHeader actions={actions} description={description} title={title} />
      {children}
    </section>
  );
}

function AccessDrawerSectionHeader({
  actions,
  description,
  title,
}: Readonly<Pick<AccessDrawerSectionProps, 'actions' | 'description' | 'title'>>): JSX.Element | null {
  if (title === undefined && actions === undefined && description === undefined) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        {title === undefined ? <span /> : <AccessDrawerSectionTitle>{title}</AccessDrawerSectionTitle>}
        {actions}
      </div>
      {description === undefined ? null : (
        <AccessDrawerSectionDescription>{description}</AccessDrawerSectionDescription>
      )}
    </div>
  );
}

function AccessDrawerSectionTitle({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-[var(--cpt-text-secondary,#485259)]">
      {children}
    </h3>
  );
}

function AccessDrawerSectionDescription({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return <p className="text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">{children}</p>;
}

function useDrawerCloseAnimation(
  closeHref: string,
  onNavigate: BrowserSoftNavigateHandler,
): { isClosing: boolean; onClose: () => void } {
  const [isClosing, setIsClosing] = useState<boolean>(false);

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

  return {
    isClosing,
    onClose: (): void => {
      setIsClosing(true);
    },
  };
}

export function AccessDrawerSummaryText({ children }: Readonly<AccessDrawerSummaryTextProps>): JSX.Element {
  return <span className="text-[13px] leading-[18px] text-[var(--cpt-text-muted,#8f98a1)]">{children}</span>;
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

function AccessDrawerPanel({
  actions,
  children,
  eyebrow,
  footer,
  header,
  isClosing,
  onClose,
  panelClassName,
  subtitle,
  title,
}: Readonly<AccessDrawerPanelProps>): JSX.Element {
  return (
    <aside className={readDrawerPanelClassName(isClosing, panelClassName)}>
      {header ?? (
        <AccessDrawerHeader actions={actions} eyebrow={eyebrow} onClose={onClose} subtitle={subtitle} title={title} />
      )}
      <AccessDrawerBody>{children}</AccessDrawerBody>
      {footer === undefined ? null : <div className="border-t border-border px-5 py-4">{footer}</div>}
    </aside>
  );
}

function AccessDrawerBody({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return <div className="flex-1 overflow-y-auto px-4 py-0">{children}</div>;
}

function AccessDrawerBackdrop({ onClose }: Readonly<{ onClose: () => void }>): JSX.Element {
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
    'fixed inset-0 z-40 flex justify-end',
    isClosing
      ? 'animate-out fade-out-0 duration-200 [animation-fill-mode:forwards]'
      : 'animate-in fade-in-0 duration-200',
  );
}

function readDrawerPanelClassName(isClosing: boolean, panelClassName: string | undefined): string {
  return cn(
    'flex h-full w-full max-w-[704px] flex-col overflow-hidden border-l border-border bg-background shadow-[-16px_0_40px_rgba(15,23,42,0.05)]',
    isClosing
      ? 'animate-out slide-out-to-right-full duration-200 [animation-fill-mode:forwards]'
      : 'animate-in slide-in-from-right-full duration-200',
    panelClassName,
  );
}
