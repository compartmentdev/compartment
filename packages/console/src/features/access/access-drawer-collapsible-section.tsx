import { useId, useState, type JSX, type ReactNode } from 'react';
import { ChevronDown } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { AccessDrawerSummaryText } from './access-ui';

interface AccessDrawerCollapsibleSectionProps {
  children: ReactNode;
  defaultExpanded: boolean;
  description?: ReactNode;
  summary: ReactNode;
  title: string;
}

interface AccessDrawerCollapsibleSectionIds {
  content: string;
  description: string;
  summary: string;
  title: string;
}

interface AccessDrawerCollapsibleHeaderProps {
  description?: ReactNode;
  ids: AccessDrawerCollapsibleSectionIds;
  isExpanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  title: string;
}

export function AccessDrawerCollapsibleSection(props: Readonly<AccessDrawerCollapsibleSectionProps>): JSX.Element {
  const { children, defaultExpanded, description, summary, title } = props;
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const ids: AccessDrawerCollapsibleSectionIds = useAccessDrawerCollapsibleSectionIds();
  const onToggle: () => void = (): void => setIsExpanded((value: boolean): boolean => !value);

  return (
    <section className="-mx-4 border-t border-border px-4 py-6">
      <AccessDrawerCollapsibleHeader
        description={description}
        ids={ids}
        isExpanded={isExpanded}
        onToggle={onToggle}
        summary={summary}
        title={title}
      />
      <AccessDrawerCollapsibleContent ids={ids} isExpanded={isExpanded}>
        {children}
      </AccessDrawerCollapsibleContent>
    </section>
  );
}

function AccessDrawerCollapsibleHeader(props: Readonly<AccessDrawerCollapsibleHeaderProps>): JSX.Element {
  const { description, ids, isExpanded, onToggle, summary, title } = props;
  const describedBy: string = [description === undefined || description === null ? null : ids.description, ids.summary]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      aria-controls={ids.content}
      aria-describedby={describedBy}
      aria-expanded={isExpanded}
      aria-labelledby={ids.title}
      className="flex w-full items-start justify-between gap-3 text-left"
      onClick={onToggle}
      type="button"
    >
      <AccessDrawerCollapsibleHeaderText description={description} ids={ids} title={title} />
      <AccessDrawerCollapsibleHeaderSummary ids={ids} isExpanded={isExpanded} summary={summary} />
    </button>
  );
}

function AccessDrawerCollapsibleHeaderText({
  description,
  ids,
  title,
}: Readonly<Pick<AccessDrawerCollapsibleHeaderProps, 'description' | 'ids' | 'title'>>): JSX.Element {
  return (
    <span className="min-w-0 flex-1">
      <span aria-level={3} className={collapsibleHeadingClassName} id={ids.title} role="heading">
        {title}
      </span>
      {renderCollapsibleHeaderDescription(description, ids.description)}
    </span>
  );
}

const collapsibleHeadingClassName: string = 'block text-[20px] font-semibold leading-7 tracking-normal text-foreground';

function renderCollapsibleHeaderDescription(
  description: ReactNode | undefined,
  descriptionId: string,
): JSX.Element | null {
  if (description === undefined || description === null) {
    return null;
  }

  return (
    <span className="mt-2 block text-[13px] leading-5 text-muted-foreground" id={descriptionId}>
      {description}
    </span>
  );
}

function AccessDrawerCollapsibleHeaderSummary({
  ids,
  isExpanded,
  summary,
}: Readonly<Pick<AccessDrawerCollapsibleHeaderProps, 'ids' | 'isExpanded' | 'summary'>>): JSX.Element {
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-2">
      <AccessDrawerSummaryText>
        <span id={ids.summary}>{summary}</span>
      </AccessDrawerSummaryText>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0 text-[var(--cpt-text-muted,#8f98a1)] transition-transform duration-200',
          isExpanded ? 'rotate-180' : undefined,
        )}
      />
    </span>
  );
}

function AccessDrawerCollapsibleContent({
  children,
  ids,
  isExpanded,
}: Readonly<{ children: ReactNode; ids: AccessDrawerCollapsibleSectionIds; isExpanded: boolean }>): JSX.Element {
  return (
    <div
      aria-hidden={!isExpanded}
      aria-labelledby={ids.title}
      className={readCollapsibleContentClassName(isExpanded)}
      id={ids.content}
      inert={!isExpanded}
      role="region"
    >
      <div className="min-h-0 overflow-hidden pt-3">{children}</div>
    </div>
  );
}

function useAccessDrawerCollapsibleSectionIds(): AccessDrawerCollapsibleSectionIds {
  return {
    content: useId(),
    description: useId(),
    summary: useId(),
    title: useId(),
  };
}

function readCollapsibleContentClassName(isExpanded: boolean): string {
  return cn(
    'grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-in-out',
    isExpanded ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0',
  );
}
