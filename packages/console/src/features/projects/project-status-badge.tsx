import type { JSX } from 'react';
import { StatusTag, type StatusTagIconName, type StatusTagVariant } from '../../components/ui/status-tag';
import type { BrowserProjectStatus } from '../../services/browser-projects.service.types';

interface ProjectStatusBadgeProps {
  status: BrowserProjectStatus;
}

interface StatusPresentation {
  icon: StatusTagIconName;
  label: string;
  variant: StatusTagVariant;
}

export function ProjectStatusBadge({ status }: Readonly<ProjectStatusBadgeProps>): JSX.Element {
  const presentation: StatusPresentation = readStatusPresentation(status);

  return <StatusTag icon={presentation.icon} label={presentation.label} variant={presentation.variant} />;
}

function readStatusPresentation(status: BrowserProjectStatus): StatusPresentation {
  return statusPresentationByStatus[status];
}

const statusPresentationByStatus: Record<BrowserProjectStatus, StatusPresentation> = {
  archived: createStatusPresentation('Archived', 'secondary', 'archived-queued'),
  healthy: createStatusPresentation('Active', 'success', 'active'),
  needs_attention: createStatusPresentation('Needs attention', 'error', 'attention'),
  not_deployed: createStatusPresentation('Not deployed', 'secondary', 'not-deployed'),
  stopped: createStatusPresentation('Stopped', 'secondary', 'stopped'),
  updating: createStatusPresentation('Updating', 'secondary', 'updating'),
};

function createStatusPresentation(
  label: string,
  variant: StatusTagVariant,
  icon: StatusTagIconName,
): StatusPresentation {
  return {
    icon,
    label,
    variant,
  };
}
