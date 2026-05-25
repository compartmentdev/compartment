import type { SelfHostedInstallPaths } from './self-hosted-install-paths.types';
import type { SelfHostedInstallState } from './self-hosted-install-state.types';

export interface ReadSelfHostedInstallResult {
  environmentText: string;
  installPaths: SelfHostedInstallPaths;
  state: SelfHostedInstallState;
}

export type ReadSelfHostedInstallForUpdateResult = ReadSelfHostedInstallResult;
