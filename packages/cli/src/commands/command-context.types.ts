import type { RemoteContextResolutionErrorCode } from '../services/remote-context.types';

export type AuthenticatedContextErrorCode =
  | 'no_configured_login'
  | 'remote_logged_out'
  | RemoteContextResolutionErrorCode;

export interface AuthenticatedContextErrorDetails {
  remoteName?: string | undefined;
}
