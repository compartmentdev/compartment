import { formatBrowserTimestamp } from '../../lib/browser-timestamp-format';

export const deploymentInProgressLabel: string = 'In progress';

export function formatDeploymentEndedAt(value: string | null): string {
  return value === null ? deploymentInProgressLabel : formatBrowserTimestamp(value);
}
