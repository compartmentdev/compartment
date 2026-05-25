import type { LoginResponse } from '@compartment/contracts';
import type { CliOrganizationConfig } from '../../store/config.types';

export interface LoginCommandResult {
  currentOrganization?: CliOrganizationConfig | undefined;
  response: LoginResponse;
}
