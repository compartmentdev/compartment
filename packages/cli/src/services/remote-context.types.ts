import type { CliRemoteConfig } from '../store/config.types';
import type { ProjectStateScope } from './project-state-scope.service.types';

export interface RemoteContextInput {
  cwd: string;
  projectStateScope?: ProjectStateScope | undefined;
  remoteName?: string | undefined;
}

export type RemoteContextResolutionErrorCode = 'remote_not_configured' | 'remote_selection_required';

export interface ResolvedRemoteContext {
  remote: CliRemoteConfig;
  remoteName: string;
}

interface RemoteContextResolutionErrorInput {
  code: RemoteContextResolutionErrorCode;
  message?: string | undefined;
  remoteName?: string | undefined;
}

export class RemoteContextResolutionError extends Error {
  readonly code: RemoteContextResolutionErrorCode;
  readonly remoteName?: string | undefined;

  constructor(input: RemoteContextResolutionErrorInput) {
    super(input.message ?? input.code);
    this.code = input.code;
    this.name = 'RemoteContextResolutionError';
    this.remoteName = input.remoteName;
  }
}
