import { compartmentProjectNameSchema } from './compartment-descriptor.contract';
import type { ContractSchema } from './schema.types';

export type {
  CliRemoteListResponse,
  CliRemoteRemoveResponse,
  CliRemoteResponse,
  CliRemoteSummary,
} from './remote.contract.types';

export const compartmentRemoteNameSchema: ContractSchema<string> = compartmentProjectNameSchema;
