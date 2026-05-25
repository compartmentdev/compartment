import type { LoginOrganizationChoice, LoginSsoProviderOption, LoginStateResponse } from '@compartment/contracts';
import type {
  BrowserLoginEmailEntryState,
  BrowserLoginFlowState,
  BrowserLoginMethodsState,
  BrowserLoginOrganizationSelectionState,
  BrowserLoginRedirectState,
} from '../../services/browser-login-flow.service.types';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';

export function buildLoginStateResponse(
  state: BrowserLoginFlowState,
  flowTarget: BrowserFlowTargetOrNull,
  principalEmail: string | undefined,
): LoginStateResponse {
  switch (state.kind) {
    case 'email_entry':
      return buildEmailEntryStateResponse(state, flowTarget, principalEmail);
    case 'methods':
      return buildMethodsStateResponse(state, principalEmail);
    case 'organization_selection':
      return buildOrganizationSelectionStateResponse(state, principalEmail);
    case 'redirect':
      return buildRedirectStateResponse(state, flowTarget, principalEmail);
  }
}

function buildEmailEntryStateResponse(
  state: BrowserLoginEmailEntryState,
  flowTarget: BrowserFlowTargetOrNull,
  principalEmail: string | undefined,
): LoginStateResponse {
  return {
    flowTarget: state.flowTarget ?? flowTarget,
    ...(principalEmail !== undefined ? { principalEmail } : {}),
    view: 'email_entry',
  };
}

function buildMethodsStateResponse(
  state: BrowserLoginMethodsState,
  principalEmail: string | undefined,
): LoginStateResponse {
  return {
    ...(state.email !== undefined ? { email: state.email } : {}),
    flowTarget: state.flowTarget,
    localPasswordEnabled: state.localPasswordEnabled,
    ...(state.organizationSlug !== undefined ? { organizationSlug: state.organizationSlug } : {}),
    ...(principalEmail !== undefined ? { principalEmail } : {}),
    ssoOptions: state.ssoOptions.map(toLoginSsoProviderOption),
    view: 'methods',
  };
}

function buildOrganizationSelectionStateResponse(
  state: BrowserLoginOrganizationSelectionState,
  principalEmail: string | undefined,
): LoginStateResponse {
  return {
    email: state.email,
    flowTarget: state.flowTarget,
    organizationChoices: state.organizations.map(toLoginOrganizationChoice),
    ...(principalEmail !== undefined ? { principalEmail } : {}),
    view: 'organization_selection',
  };
}

function toLoginOrganizationChoice(organization: LoginOrganizationChoice): LoginOrganizationChoice {
  return {
    name: organization.name,
    slug: organization.slug,
  };
}

function toLoginSsoProviderOption(option: LoginSsoProviderOption): LoginSsoProviderOption {
  return {
    buttonText: option.buttonText,
    loginUrl: option.loginUrl,
    providerId: option.providerId,
  };
}

function buildRedirectStateResponse(
  state: BrowserLoginRedirectState,
  flowTarget: BrowserFlowTargetOrNull,
  principalEmail: string | undefined,
): LoginStateResponse {
  return {
    flowTarget,
    ...(principalEmail !== undefined ? { principalEmail } : {}),
    redirectTo: state.redirectUrl,
    view: 'redirect',
  };
}
