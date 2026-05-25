import type { DomainHostPlan } from '@compartment/contracts';
import type { ApiConfig } from '../config';

export interface DomainCheckFailure {
  code: string;
  message: string;
}

export interface DomainCheckResult {
  failure: DomainCheckFailure | null;
}

export interface ActiveDomainProbeInput {
  config: ApiConfig;
  hostPlan: DomainHostPlan;
}
