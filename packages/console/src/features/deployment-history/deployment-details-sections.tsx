import {
  formatDeploymentRunLogLineText,
  readDeploymentRunTriggerRepositoryLabel,
  type DeploymentRunLogLine,
  type DeploymentRunStepSummary,
  type DeploymentRunSummary,
} from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { StatusTag } from '../../components/ui/status-tag';
import { formatBrowserTimestamp } from '../../lib/browser-timestamp-format';
import { cn } from '../../lib/utils';
import { formatDeploymentDuration } from './deployment-history-duration';
import { formatDeploymentEndedAt } from './deployment-history-ended-at';
import {
  deploymentRunStepLabels,
  deploymentRunStepStatusLabels,
  deploymentStatusLabels,
  deploymentTriggerLabels,
  readDeploymentRunStepTagIcon,
  readDeploymentRunStepTagVariant,
  readDeploymentStatusTagIcon,
  readDeploymentStatusTagVariant,
} from './deployment-history-labels';

export { DeploymentDetailsServicesSection } from './deployment-details-services-section';

interface DeploymentDetailsSummarySectionProps {
  deployment: DeploymentRunSummary;
}

interface DeploymentDetailsTimelineSectionProps {
  steps: DeploymentRunStepSummary[];
}

interface DeploymentDetailsLogsSectionProps {
  lines: DeploymentRunLogLine[];
}

interface DetailItemProps {
  label: string;
  value: string;
}

export function DeploymentDetailsSummarySection({
  deployment,
}: Readonly<DeploymentDetailsSummarySectionProps>): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <DeploymentSummaryBody deployment={deployment} />
        <DeploymentMetadataGrid deployment={deployment} />
      </div>
    </section>
  );
}

function DeploymentSummaryBody({ deployment }: Readonly<DeploymentDetailsSummarySectionProps>): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusTag
          icon={readDeploymentStatusTagIcon(deployment.status)}
          label={deploymentStatusLabels[deployment.status]}
          variant={readDeploymentStatusTagVariant(deployment.status)}
        />
        <span className="text-[13px] text-muted-foreground">
          {formatDeploymentDuration(deployment.createdAt, deployment.completedAt)}
        </span>
      </div>
      <p className="text-[14px] font-medium text-foreground">{deployment.label ?? 'deployment.run'}</p>
      <DetailItemsList items={buildSummaryIdItems(deployment.id)} />
      <DeploymentFailureMessage message={deployment.failureMessage} />
    </div>
  );
}

function DeploymentMetadataGrid({
  deployment,
}: Readonly<Pick<DeploymentDetailsSummarySectionProps, 'deployment'>>): JSX.Element {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
      <DetailItem label="Trigger" value={deploymentTriggerLabels[deployment.trigger.type]} />
      <DetailItem label="Repository" value={readRepositoryValue(deployment)} />
      <DetailItem label="Branch" value={deployment.trigger.branchName ?? 'n/a'} />
      <DetailItem label="Commit" value={deployment.trigger.commitSha ?? 'n/a'} />
      <DetailItem label="Started" value={formatBrowserTimestamp(deployment.createdAt)} />
      <DetailItem label="Ended" value={formatDeploymentEndedAt(deployment.completedAt)} />
    </dl>
  );
}

export function DeploymentDetailsTimelineSection({
  steps,
}: Readonly<DeploymentDetailsTimelineSectionProps>): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-foreground">Timeline</h2>
        <span className="text-[12px] text-muted-foreground">{steps.length} steps</span>
      </div>
      {steps.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No deployment steps were recorded.</p>
      ) : (
        <ol className="flex flex-col gap-3">{steps.map(renderTimelineItem)}</ol>
      )}
    </section>
  );
}

function renderTimelineItem(step: DeploymentRunStepSummary, index: number): JSX.Element {
  return (
    <li className={readTimelineItemClassName(step)} key={readTimelineItemKey(step, index)}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium text-foreground">{deploymentRunStepLabels[step.stepKey]}</p>
            <StatusTag
              icon={readDeploymentRunStepTagIcon(step.status)}
              label={deploymentRunStepStatusLabels[step.status]}
              variant={readDeploymentRunStepTagVariant(step.status)}
            />
          </div>
          <p className="text-[12px] text-muted-foreground">{readTimelineMetadata(step)}</p>
        </div>
        <p className="max-w-3xl whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground/90">
          {step.message}
        </p>
      </div>
    </li>
  );
}

export function DeploymentDetailsLogsSection({ lines }: Readonly<DeploymentDetailsLogsSectionProps>): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-foreground">Logs</h2>
        <span className="text-[12px] text-muted-foreground">{lines.length} lines</span>
      </div>
      {lines.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No persisted deployment logs were recorded.</p>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-muted/25 p-3 font-mono text-[12px] leading-5 text-foreground">
          {lines.map(formatDeploymentRunLogLineText).join('\n')}
        </pre>
      )}
    </section>
  );
}

function readTimelineItemKey(step: DeploymentRunStepSummary, index: number): string {
  return `${step.deploymentId ?? 'run'}:${step.stepKey}:${index}`;
}

function readTimelineItemClassName(step: DeploymentRunStepSummary): string {
  return cn(
    'rounded-md border px-3 py-3',
    step.status === 'failed' ? 'border-red-200 bg-red-50/60' : 'border-border bg-muted/20',
  );
}

function readTimelineMetadata(step: DeploymentRunStepSummary): string {
  return `${step.serviceName ?? 'All services'} · ${formatBrowserTimestamp(step.createdAt)} · ${formatDeploymentEndedAt(step.completedAt)}`;
}

function readRepositoryValue(deployment: DeploymentRunSummary): string {
  return readDeploymentRunTriggerRepositoryLabel(deployment.trigger) ?? 'n/a';
}

function buildSummaryIdItems(runId: string): readonly DetailItemProps[] {
  return [{ label: 'Run ID', value: runId }];
}

function DetailItemsList({ items }: Readonly<{ items: readonly DetailItemProps[] }>): JSX.Element {
  return (
    <dl className="grid gap-1 text-[12px] text-muted-foreground">
      {items.map(
        (item: DetailItemProps): JSX.Element => (
          <DetailItem key={item.label} label={item.label} value={item.value} />
        ),
      )}
    </dl>
  );
}

function DeploymentFailureMessage({ message }: Readonly<{ message: string | null }>): JSX.Element | null {
  if (message === null) {
    return null;
  }

  return <p className="max-w-3xl whitespace-pre-wrap break-words text-[13px] leading-5 text-destructive">{message}</p>;
}

function DetailItem({ label, value }: Readonly<DetailItemProps>): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-foreground">{value}</dd>
    </div>
  );
}
