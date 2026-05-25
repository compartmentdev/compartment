import type { AppAccessBrowserFlowTarget } from '@compartment/contracts';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { BrowserSsoProviderOption } from './sso-oidc/sso-oidc.service.types';

export interface BrowserLoginDiscoveryInput {
  email?: string | undefined;
  flowTarget: AppAccessBrowserFlowTarget | null;
  organizationSlug?: string | undefined;
}

export interface BrowserLoginMethodsState {
  email?: string | undefined;
  flowTarget: AppAccessBrowserFlowTarget | null;
  kind: 'methods';
  localPasswordEnabled: boolean;
  organizationSlug?: string | undefined;
  ssoOptions: BrowserSsoProviderOption[];
}

export interface BrowserLoginOrganizationSelectionState {
  email: string;
  flowTarget: AppAccessBrowserFlowTarget | null;
  kind: 'organization_selection';
  organizations: OrganizationRow[];
}

export interface BrowserLoginEmailEntryState {
  flowTarget: AppAccessBrowserFlowTarget | null;
  kind: 'email_entry';
}

export interface BrowserLoginRedirectState {
  kind: 'redirect';
  redirectUrl: string;
}

export type BrowserLoginFlowState =
  | BrowserLoginEmailEntryState
  | BrowserLoginMethodsState
  | BrowserLoginOrganizationSelectionState
  | BrowserLoginRedirectState;
