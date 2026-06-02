import type { DeploymentReadSummary } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { BrowserTimestampTableCell } from '../../components/browser-timestamp';
import {
  ServerTable,
  ServerTableCell,
  ServerTableEmptyRow,
  ServerTableFrame,
  ServerTableHeading,
  ServerTableRow,
} from '../../components/server-table';
import { StatusTag } from '../../components/ui/status-tag';
import { formatDeploymentDuration } from './deployment-history-duration';
import { deploymentInProgressLabel } from './deployment-history-ended-at';
import {
  deploymentStageLabels,
  deploymentStatusLabels,
  readDeploymentStageTagIcon,
  readDeploymentStageTagVariant,
  readDeploymentStatusTagIcon,
  readDeploymentStatusTagVariant,
} from './deployment-history-labels';

interface DeploymentDetailsServicesSectionProps {
  deployments: DeploymentReadSummary[];
}

interface DeploymentServiceCellProps {
  deployment: DeploymentReadSummary;
}

export function DeploymentDetailsServicesSection({
  deployments,
}: Readonly<DeploymentDetailsServicesSectionProps>): JSX.Element {
  return (
    <ServerTableFrame>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold text-foreground">Services</h2>
      </div>
      <ServerTable minWidthClassName="min-w-[760px]">
        <thead className="bg-card">
          <tr>
            <ServerTableHeading label="Service" />
            <ServerTableHeading label="Status" />
            <ServerTableHeading label="Stage" />
            <ServerTableHeading label="Started" />
            <ServerTableHeading label="Ended" />
            <ServerTableHeading label="Duration" />
          </tr>
        </thead>
        <tbody>{renderServiceRows(deployments)}</tbody>
      </ServerTable>
    </ServerTableFrame>
  );
}

function renderServiceRows(deployments: DeploymentReadSummary[]): JSX.Element[] {
  if (deployments.length === 0) {
    return [
      <ServerTableEmptyRow colSpan={6} key="empty" message="No services were recorded for this deployment run." />,
    ];
  }

  return deployments.map(renderServiceRow);
}

function renderServiceRow(deployment: DeploymentReadSummary): JSX.Element {
  return (
    <ServerTableRow key={deployment.id}>
      <DeploymentServiceIdentityCell deployment={deployment} />
      <DeploymentServiceStatusCell deployment={deployment} />
      <DeploymentServiceStageCell deployment={deployment} />
      <BrowserTimestampTableCell emptyLabel={deploymentInProgressLabel} value={deployment.createdAt} />
      <BrowserTimestampTableCell emptyLabel={deploymentInProgressLabel} value={deployment.completedAt} />
      <ServerTableCell className="whitespace-nowrap">
        {formatDeploymentDuration(deployment.createdAt, deployment.completedAt)}
      </ServerTableCell>
    </ServerTableRow>
  );
}

function DeploymentServiceIdentityCell({ deployment }: Readonly<DeploymentServiceCellProps>): JSX.Element {
  return (
    <ServerTableCell>
      <p className="font-medium text-foreground">{deployment.serviceName}</p>
      <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{deployment.id}</p>
    </ServerTableCell>
  );
}

function DeploymentServiceStatusCell({ deployment }: Readonly<DeploymentServiceCellProps>): JSX.Element {
  return (
    <ServerTableCell>
      <StatusTag
        icon={readDeploymentStatusTagIcon(deployment.status)}
        label={deploymentStatusLabels[deployment.status]}
        variant={readDeploymentStatusTagVariant(deployment.status)}
      />
    </ServerTableCell>
  );
}

function DeploymentServiceStageCell({ deployment }: Readonly<DeploymentServiceCellProps>): JSX.Element {
  return (
    <ServerTableCell>
      <StatusTag
        icon={readDeploymentStageTagIcon(deployment.promotionStage)}
        label={deploymentStageLabels[deployment.promotionStage]}
        variant={readDeploymentStageTagVariant(deployment.promotionStage)}
      />
    </ServerTableCell>
  );
}
