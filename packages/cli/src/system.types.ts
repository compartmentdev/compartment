import type { SystemRestartResponse, SystemStatusResponse } from '@compartment/contracts';
import type { InstallContext } from './install.types';

export interface SelfHostedSystemInput {
  context?: InstallContext | undefined;
}

export type SelfHostedSystemRestartResult = SystemRestartResponse;
export type SelfHostedSystemStatusResult = SystemStatusResponse;
