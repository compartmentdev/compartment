import type { DeploymentRunStepStatus, DeploymentRunStepSummary } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { StatusTag } from '../../components/ui/status-tag';
import { formatBrowserTimestamp } from '../../lib/browser-timestamp-format';
import { cn } from '../../lib/utils';
import { formatDeploymentDuration } from './deployment-history-duration';
import { formatDeploymentEndedAt } from './deployment-history-ended-at';
import {
  deploymentRunStepLabels,
  deploymentRunStepStatusLabels,
  readDeploymentRunStepTagIcon,
  readDeploymentRunStepTagVariant,
} from './deployment-history-labels';

interface DeploymentDetailsTimelineSectionProps {
  steps: DeploymentRunStepSummary[];
}

interface TimelineItemProps {
  isLast: boolean;
  step: DeploymentRunStepSummary;
}

interface TimelineMarkerProps {
  status: DeploymentRunStepStatus;
}

interface TimelineStepBodyProps {
  step: DeploymentRunStepSummary;
}

interface TimelineStepDescriptionProps {
  message: string;
}

export function DeploymentDetailsTimelineSection({
  steps,
}: Readonly<DeploymentDetailsTimelineSectionProps>): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold leading-7 text-foreground [font-variation-settings:'opsz'_14]">
          Timeline
        </h2>
        <span className="text-[12px] font-normal leading-4 text-muted-foreground [font-variation-settings:'opsz'_14]">
          {steps.length} steps
        </span>
      </div>
      {steps.length === 0 ? (
        <DeploymentTimelineEmptyState />
      ) : (
        <ol className="overflow-hidden rounded-field border border-border bg-background">
          {renderTimelineItems(steps)}
        </ol>
      )}
    </section>
  );
}

function DeploymentTimelineEmptyState(): JSX.Element {
  return (
    <div className="rounded-field border border-border bg-background px-[14px] py-3">
      <p className="text-[13px] text-muted-foreground">No deployment steps were recorded.</p>
    </div>
  );
}

function renderTimelineItems(steps: readonly DeploymentRunStepSummary[]): JSX.Element[] {
  return steps.map(
    (step: DeploymentRunStepSummary, index: number): JSX.Element => (
      <DeploymentTimelineItem isLast={index === steps.length - 1} key={readTimelineItemKey(step, index)} step={step} />
    ),
  );
}

function DeploymentTimelineItem({ isLast, step }: Readonly<TimelineItemProps>): JSX.Element {
  return (
    <li className={cn('flex gap-[14px] px-[14px]', isLast ? undefined : 'border-b border-border')}>
      <TimelineMarker status={step.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between md:gap-[14px]">
        <TimelineStepBody step={step} />
        <TimelineStepTimeRange step={step} />
      </div>
    </li>
  );
}

function TimelineMarker({ status }: Readonly<TimelineMarkerProps>): JSX.Element {
  return (
    <div className="relative w-[18px] shrink-0 self-stretch">
      <span aria-hidden="true" className="absolute left-1/2 top-0 h-full -translate-x-1/2 border-l border-border" />
      <span aria-hidden="true" className={readTimelineMarkerDotClassName(status)} />
    </div>
  );
}

function TimelineStepBody({ step }: Readonly<TimelineStepBodyProps>): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
      <TimelineStepHeader step={step} />
      <TimelineStepDescription message={step.message} />
      <TimelineStepMetadata step={step} />
    </div>
  );
}

function TimelineStepHeader({ step }: Readonly<TimelineStepBodyProps>): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-[10px] pb-1">
      <p className="truncate text-[13px] font-semibold leading-5 text-foreground [font-variation-settings:'opsz'_14]">
        {deploymentRunStepLabels[step.stepKey]}
      </p>
      <StatusTag
        className="shrink-0"
        icon={readDeploymentRunStepTagIcon(step.status)}
        label={deploymentRunStepStatusLabels[step.status]}
        variant={readDeploymentRunStepTagVariant(step.status)}
      />
    </div>
  );
}

function TimelineStepDescription({ message }: Readonly<TimelineStepDescriptionProps>): JSX.Element {
  return (
    <p className="max-w-[650px] whitespace-pre-wrap break-words text-[12px] font-normal leading-4 text-muted-foreground [font-variation-settings:'opsz'_14]">
      {message}
    </p>
  );
}

function TimelineStepMetadata({ step }: Readonly<TimelineStepBodyProps>): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] leading-4 [font-variation-settings:'opsz'_14]">
      <span className="font-semibold text-muted-foreground">{readTimelineServiceLabel(step)}</span>
      <span className="font-normal text-muted-foreground-secondary">·</span>
      <span className="font-normal text-muted-foreground">{readTimelineProgressLabel(step)}</span>
    </div>
  );
}

function TimelineStepTimeRange({ step }: Readonly<TimelineStepBodyProps>): JSX.Element {
  return (
    <p className="shrink-0 text-left text-[12px] font-normal leading-4 text-muted-foreground-secondary [font-variation-settings:'opsz'_14] md:text-right">
      {readTimelineTimeRange(step)}
    </p>
  );
}

function readTimelineItemKey(step: DeploymentRunStepSummary, index: number): string {
  return `${step.deploymentId ?? 'run'}:${step.stepKey}:${index}`;
}

function readTimelineMarkerDotClassName(status: DeploymentRunStepStatus): string {
  return cn(
    'absolute left-1/2 top-4 size-2.5 -translate-x-1/2 rounded-pill border-2 bg-background',
    readTimelineMarkerDotToneClassName(status),
  );
}

function readTimelineMarkerDotToneClassName(status: DeploymentRunStepStatus): string {
  switch (status) {
    case 'failed':
      return 'border-destructive';
    case 'succeeded':
      return 'border-success';
    case 'running':
    case 'skipped':
      return 'border-muted-foreground';
  }
}

function readTimelineServiceLabel(step: DeploymentRunStepSummary): string {
  return step.serviceName ?? 'All services';
}

function readTimelineProgressLabel(step: DeploymentRunStepSummary): string {
  switch (step.status) {
    case 'failed':
      return step.completedAt === null
        ? 'Failed'
        : `Failed after ${formatDeploymentDuration(step.createdAt, step.completedAt)}`;
    case 'running':
      return 'In progress';
    case 'skipped':
      return 'Not run';
    case 'succeeded':
      return readTimelineSucceededProgressLabel(step);
  }
}

function readTimelineSucceededProgressLabel(step: DeploymentRunStepSummary): string {
  if (step.completedAt === null) {
    return 'Completed';
  }

  const duration: string = formatDeploymentDuration(step.createdAt, step.completedAt);
  return duration === '0s' ? 'Completed immediately' : `Completed in ${duration}`;
}

function readTimelineTimeRange(step: DeploymentRunStepSummary): string {
  return `${formatBrowserTimestamp(step.createdAt)} · ${formatDeploymentEndedAt(step.completedAt)}`;
}
