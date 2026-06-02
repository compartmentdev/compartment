import {
  buildDeploymentReadRunGroups,
  type DeploymentReadRunGroup,
  type DeploymentReadSummary,
} from '@compartment/contracts/browser';
import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserTimestampTableCell } from '../../components/browser-timestamp';
import {
  ServerTable,
  ServerTableCell,
  ServerTableColumnGroup,
  ServerTableEmptyRow,
  ServerTableHeading,
  ServerTableRow,
  type ServerTableColumnDefinition,
} from '../../components/server-table';
import { StatusTag } from '../../components/ui/status-tag';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import { type DeploymentHistoryRollbackHandler } from './deployment-history-actions';
import { formatDeploymentDuration } from './deployment-history-duration';
import { deploymentInProgressLabel } from './deployment-history-ended-at';
import {
  deploymentStatusLabels,
  readDeploymentStatusTagIcon,
  readDeploymentStatusTagVariant,
} from './deployment-history-labels';
import { DeploymentHistoryTableActions } from './deployment-history-table-actions';

interface DeploymentHistoryTableProps {
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onRollback: DeploymentHistoryRollbackHandler;
}

interface DeploymentHistoryRunRowProps {
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onRollback: DeploymentHistoryRollbackHandler;
  run: DeploymentReadRunGroup;
}

interface DeploymentRunIdentityCellProps {
  run: DeploymentReadRunGroup;
}

interface DeploymentRunStatusCellProps {
  run: DeploymentReadRunGroup;
}

interface DeploymentRunServicesCellProps {
  run: DeploymentReadRunGroup;
}

interface DeploymentRunDurationCellProps {
  completedAt: string | null;
  createdAt: string;
}

interface DeploymentHistoryColumn extends ServerTableColumnDefinition {
  align?: 'left' | 'right';
  label: string;
}

const deploymentHistoryColumns: DeploymentHistoryColumn[] = [
  { className: 'w-[12rem]', key: 'run', label: 'Run' },
  { className: 'w-[7.25rem]', key: 'status', label: 'Status' },
  { className: 'w-[12rem]', key: 'services', label: 'Services' },
  { className: 'w-[8rem]', key: 'started', label: 'Started' },
  { className: 'w-[8rem]', key: 'ended', label: 'Ended' },
  { className: 'w-[5.75rem]', key: 'duration', label: 'Duration' },
  { align: 'right', className: 'w-[7.5rem]', key: 'actions', label: 'Actions' },
];

export function DeploymentHistoryTable({
  data,
  onNavigate,
  onRollback,
}: Readonly<DeploymentHistoryTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[1008px] table-fixed">
      <ServerTableColumnGroup columns={deploymentHistoryColumns} />
      <DeploymentHistoryTableHead />
      <tbody>{renderDeploymentHistoryRows(data, onNavigate, onRollback)}</tbody>
    </ServerTable>
  );
}

function DeploymentHistoryTableHead(): JSX.Element {
  return (
    <thead className="bg-card">
      <tr>{deploymentHistoryColumns.map(renderDeploymentHistoryHeading)}</tr>
    </thead>
  );
}

function renderDeploymentHistoryHeading(column: DeploymentHistoryColumn): JSX.Element {
  return (
    <ServerTableHeading
      align={column.align ?? 'left'}
      className={column.className}
      key={column.key}
      label={column.label}
    />
  );
}

function renderDeploymentHistoryRows(
  data: BrowserDeploymentHistoryPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onRollback: DeploymentHistoryRollbackHandler,
): JSX.Element[] {
  const runs: DeploymentReadRunGroup[] = buildDeploymentReadRunGroups(data.deployments);
  if (runs.length === 0) {
    return [<ServerTableEmptyRow colSpan={7} key="empty" message="No deployments found." />];
  }

  return runs.map(
    (run: DeploymentReadRunGroup): JSX.Element => (
      <DeploymentHistoryRunRow
        data={data}
        key={run.deploymentRunId}
        onNavigate={onNavigate}
        onRollback={onRollback}
        run={run}
      />
    ),
  );
}

function DeploymentHistoryRunRow({
  data,
  onNavigate,
  onRollback,
  run,
}: Readonly<DeploymentHistoryRunRowProps>): JSX.Element {
  return (
    <ServerTableRow>
      <DeploymentRunIdentityCell run={run} />
      <DeploymentRunStatusCell run={run} />
      <DeploymentRunServicesCell run={run} />
      <BrowserTimestampTableCell emptyLabel={deploymentInProgressLabel} value={run.createdAt} />
      <BrowserTimestampTableCell emptyLabel={deploymentInProgressLabel} value={run.completedAt} />
      <DeploymentRunDurationCell completedAt={run.completedAt} createdAt={run.createdAt} />
      <ServerTableCell align="right">
        <DeploymentHistoryTableActions data={data} onNavigate={onNavigate} onRollback={onRollback} run={run} />
      </ServerTableCell>
    </ServerTableRow>
  );
}

function DeploymentRunIdentityCell({ run }: Readonly<DeploymentRunIdentityCellProps>): JSX.Element {
  return (
    <ServerTableCell>
      <p className="text-[13px] font-medium text-foreground">{run.label}</p>
      <p className="mt-0.5 break-all text-[12px] text-muted-foreground">{run.deploymentRunId}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {run.deploymentCount === 1 ? '1 service' : `${run.deploymentCount} services`}
      </p>
      {renderFailureMessage(run.failureMessage)}
    </ServerTableCell>
  );
}

function DeploymentRunDurationCell({ completedAt, createdAt }: Readonly<DeploymentRunDurationCellProps>): JSX.Element {
  return (
    <ServerTableCell className="whitespace-nowrap">{formatDeploymentDuration(createdAt, completedAt)}</ServerTableCell>
  );
}

function DeploymentRunStatusCell({ run }: Readonly<DeploymentRunStatusCellProps>): JSX.Element {
  return (
    <ServerTableCell>
      <StatusTag
        icon={readDeploymentStatusTagIcon(run.status)}
        label={deploymentStatusLabels[run.status]}
        variant={readDeploymentStatusTagVariant(run.status)}
      />
    </ServerTableCell>
  );
}

function DeploymentRunServicesCell({ run }: Readonly<DeploymentRunServicesCellProps>): JSX.Element {
  const showServiceStatuses: boolean = shouldShowServiceStatuses(run);

  return (
    <ServerTableCell>
      <div className="space-y-3">
        {run.deployments.map(
          (deployment: DeploymentReadSummary): JSX.Element =>
            renderDeploymentServiceSummary(deployment, showServiceStatuses),
        )}
      </div>
    </ServerTableCell>
  );
}

function renderDeploymentServiceSummary(deployment: DeploymentReadSummary, showServiceStatuses: boolean): JSX.Element {
  return (
    <div className="space-y-1" key={deployment.id}>
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-foreground">{deployment.serviceName}</span>
        {showServiceStatuses ? (
          <StatusTag
            icon={readDeploymentStatusTagIcon(deployment.status)}
            label={deploymentStatusLabels[deployment.status]}
            variant={readDeploymentStatusTagVariant(deployment.status)}
          />
        ) : null}
      </div>
      <p className="mt-0.5 break-all text-[12px] text-muted-foreground">{deployment.id}</p>
    </div>
  );
}

function shouldShowServiceStatuses(run: DeploymentReadRunGroup): boolean {
  return new Set(run.deployments.map((deployment: DeploymentReadSummary): string => deployment.status)).size > 1;
}

function renderFailureMessage(message: string | null): JSX.Element | null {
  if (message === null) {
    return null;
  }

  return (
    <p className="mt-1 overflow-hidden break-words text-[12px] text-destructive [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
      {message}
    </p>
  );
}
