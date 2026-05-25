import type { CliRemoteRemoveResponse, CliRemoteResponse } from '@compartment/contracts';
import type { CliConfig } from '../store/config.types';

export interface UseRemoteResult {
  config: CliConfig;
  response: CliRemoteResponse;
  stateFilePath?: string | undefined;
  wroteProjectState: boolean;
}

export interface RemoveRemoteResult {
  config: CliConfig;
  response: CliRemoteRemoveResponse;
}
