import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { textareaFieldControlClassName } from '../../components/ui/field-styles';
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

export const accessDrawerActionButtonClassName: string =
  'h-8 gap-1.5 rounded-[8px] px-3 text-[13px] font-medium leading-5';
export const accessDrawerHeaderActionButtonClassName: string =
  'h-8 shrink-0 gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium leading-5';
export const accessDrawerPrimaryActionButtonClassName: string =
  'h-9 w-auto shrink-0 justify-center gap-1.5 rounded-[10px] px-3 text-[13px]';
export const accessDrawerRowActionButtonClassName: string = 'h-[26px] gap-1 rounded-[8px] px-2 text-[12px]';
export const accessDrawerSummaryDescriptionClassName: string =
  "max-w-full truncate text-[13px] font-normal leading-5 text-muted-foreground [font-variation-settings:'opsz'_14]";
export const accessDrawerSummaryIdentityClassName: string = 'flex min-w-0 items-center gap-2';
export const accessDrawerSummaryStackClassName: string = 'flex min-w-0 flex-col items-start gap-2';
export const accessDrawerSummaryTitleClassName: string =
  "min-w-0 truncate text-2xl font-medium leading-8 tracking-normal text-foreground [font-variation-settings:'opsz'_14]";
export const accessDrawerTextareaClassName: string = textareaFieldControlClassName;

export function AccessPageHeader({ action, description, title }: Readonly<AccessPageHeaderProps>): JSX.Element {
  return (
    <header>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold leading-8 tracking-normal text-foreground">{title}</h1>
          {description === undefined || description === null ? null : (
            <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">{description}</p>
          )}
        </div>
        {action === undefined || action === null ? null : <div className="shrink-0">{action}</div>}
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
  return <h3 className="text-[20px] font-semibold leading-7 tracking-normal text-foreground">{children}</h3>;
}

function AccessDrawerSectionDescription({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return <p className="text-[13px] leading-5 text-muted-foreground">{children}</p>;
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
      {footer === undefined ? null : <div className="border-t border-border px-4 py-4">{footer}</div>}
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
