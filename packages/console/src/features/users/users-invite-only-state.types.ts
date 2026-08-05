import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';

export interface UsersInviteOnlyStateProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}
