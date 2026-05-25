import type { StatusTagIconName, StatusTagVariant } from '../../components/ui/status-tag';
import type {
  BrowserUsersAccessState,
  BrowserUsersAccountStatus,
  BrowserUsersUserType,
} from '../../services/browser-users.service.types';

interface UserStatusTagInput {
  access: BrowserUsersAccessState;
  status: BrowserUsersAccountStatus;
  type: BrowserUsersUserType;
}

export interface UserStatusTagPresentation {
  icon: StatusTagIconName;
  label: string;
  variant: StatusTagVariant;
}

export function readUserStatusTagPresentation(input: UserStatusTagInput): UserStatusTagPresentation {
  if (input.type === 'automation') {
    return {
      icon: 'system',
      label: 'System',
      variant: 'secondary',
    };
  }

  if (input.access === 'blocked') {
    return {
      icon: 'blocked',
      label: 'Blocked',
      variant: 'secondary',
    };
  }

  return {
    icon: readUserStatusTagIcon(input.status),
    label: readUserStatusLabel(input.status),
    variant: readUserStatusTagVariant(input.status),
  };
}

function readUserStatusLabel(status: BrowserUsersAccountStatus): string {
  return status === 'active' ? 'Active' : 'Invited';
}

function readUserStatusTagVariant(status: BrowserUsersAccountStatus): StatusTagVariant {
  return status === 'active' ? 'success' : 'secondary';
}

function readUserStatusTagIcon(status: BrowserUsersAccountStatus): StatusTagIconName {
  return status === 'active' ? 'active' : 'invited';
}
