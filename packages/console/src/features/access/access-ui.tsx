import { type JSX, type ReactNode } from 'react';
import { textareaFieldControlClassName } from '../../components/ui/field-styles';
import { cn } from '../../lib/utils';

interface AccessPageHeaderProps {
  action?: ReactNode;
  description?: ReactNode;
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

export { AccessDrawerShell, useAccessDrawerCloseNavigation } from './access-drawer-shell';

export const accessDrawerActionButtonClassName: string =
  'h-8 gap-1.5 rounded-[8px] px-3 text-[13px] font-medium leading-5';
export const accessDrawerHeaderActionButtonClassName: string =
  'h-8 shrink-0 gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium leading-5';
export const accessDrawerPrimaryActionButtonClassName: string =
  'h-9 w-auto shrink-0 justify-center gap-1.5 rounded-[10px] px-3 text-[13px]';
export const accessDrawerRowActionButtonClassName: string = 'h-[26px] gap-1 rounded-[8px] px-2 text-[12px]';
export const accessDrawerSectionDividerClassName: string = '-mx-4 border-t border-border px-4 pt-4';
export const accessDrawerSummaryDescriptionClassName: string =
  "max-w-full truncate text-[13px] font-normal leading-5 text-muted-foreground [font-variation-settings:'opsz'_14]";
export const accessDrawerSummaryIdentityClassName: string = 'flex min-w-0 items-center gap-2';
export const accessDrawerSummaryStackClassName: string = 'flex min-w-0 flex-col items-start gap-2';
export const accessDrawerSummaryTitleClassName: string =
  "min-w-0 truncate text-2xl font-medium leading-8 tracking-normal text-foreground [font-variation-settings:'opsz'_14]";
export const accessDrawerTextareaClassName: string = textareaFieldControlClassName;

export function AccessPageHeader({ action, description, title }: Readonly<AccessPageHeaderProps>): JSX.Element {
  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-h-9 flex-col justify-center gap-2">
          <h1 className="flex min-h-9 items-center text-2xl font-semibold leading-8 tracking-normal text-foreground">
            {title}
          </h1>
          {description === undefined || description === null ? null : (
            <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">{description}</p>
          )}
        </div>
        {action === undefined || action === null ? null : (
          <div className="flex min-h-9 shrink-0 items-center">{action}</div>
        )}
      </div>
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

export function AccessDrawerSummaryText({ children }: Readonly<AccessDrawerSummaryTextProps>): JSX.Element {
  return <span className="text-[13px] leading-[18px] text-[var(--cpt-text-muted,#8f98a1)]">{children}</span>;
}
