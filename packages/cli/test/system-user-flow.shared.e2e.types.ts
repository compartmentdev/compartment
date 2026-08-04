import type {
  DeploymentReadSummary,
  ResourceResponse,
  VariableGroupBindingResponse,
  VariableGroupListResponse,
  VariableGroupResponse,
  VariableGroupUsagesResponse,
  VariableResponse,
} from '@compartment/contracts';
import type { SelfHostedDeployCommandResponse } from './self-hosted-user-setup-cli-response.harness';

export interface SystemUserFlowVariableSetup {
  readonly initialVariableGroups: VariableGroupListResponse;
  readonly createdGroup: VariableGroupResponse;
  readonly groupsAfterCreate: VariableGroupListResponse;
  readonly messageGroup: VariableGroupResponse;
  readonly shownGroup: VariableGroupResponse;
  readonly binding: VariableGroupBindingResponse;
  readonly variableGroupUsages: VariableGroupUsagesResponse;
  readonly directVariablePayload: VariableResponse;
  readonly buildVariablePayload: VariableResponse;
}

export interface SystemUserFlowAppDeployment {
  readonly databaseUrlBindingPayload: VariableResponse;
  readonly deployPayload: SelfHostedDeployCommandResponse;
  readonly appProjectId: string;
  readonly bootstrapPayload: ResourceResponse;
  readonly resourceReleaseDeployPayload: SelfHostedDeployCommandResponse;
  readonly routeUrl: string;
  readonly activeDeployment: DeploymentReadSummary;
  readonly adminAppSessionCookie: string;
}
