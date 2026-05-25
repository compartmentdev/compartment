import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserTimestampTableCell } from '../../components/browser-timestamp';
import { ServerTableActions, ServerTableCell, ServerTableRow } from '../../components/server-table';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import type { ProjectActionHandler } from './project-actions';
import { ProjectOpenAction } from './project-open-action';
import { projectNoDeploymentsLabel } from './project-deployment-labels';
import { ProjectOverviewLink } from './project-overview-link';
import { ProjectRowActionsDropdown } from './project-row-actions-dropdown';
import { ProjectStatusBadge } from './project-status-badge';

interface ProjectTableRowProps {
  project: BrowserProjectSummary;
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onProjectAction: ProjectActionHandler;
}

interface ProjectActionsCellProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onProjectAction: ProjectActionHandler;
  project: BrowserProjectSummary;
}

export function ProjectTableRow({
  project,
  data,
  onNavigate,
  onProjectAction,
}: Readonly<ProjectTableRowProps>): JSX.Element {
  return (
    <ServerTableRow>
      <ServerTableCell>
        <p className="text-[13px] font-medium text-foreground">{project.name}</p>
      </ServerTableCell>
      <ServerTableCell>
        <ProjectStatusBadge status={project.status} />
      </ServerTableCell>
      <ServerTableCell>{project.serviceCount}</ServerTableCell>
      <BrowserTimestampTableCell emptyLabel={projectNoDeploymentsLabel} value={project.lastDeploymentCreatedAt} />
      <BrowserTimestampTableCell emptyLabel="n/a" value={project.updatedAt} />
      <ProjectActionsCell data={data} onNavigate={onNavigate} onProjectAction={onProjectAction} project={project} />
    </ServerTableRow>
  );
}

function ProjectActionsCell({
  data,
  onNavigate,
  onProjectAction,
  project,
}: Readonly<ProjectActionsCellProps>): JSX.Element {
  return (
    <ServerTableCell align="right">
      <ServerTableActions>
        <ProjectOverviewLink data={data} onNavigate={onNavigate} project={project} />
        <ProjectOpenAction project={project} />
        <ProjectRowActionsDropdown data={data} onProjectAction={onProjectAction} project={project} />
      </ServerTableActions>
    </ServerTableCell>
  );
}
