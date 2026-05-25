export type BrowserConsoleOrganizationContext =
  | BrowserConsoleSelectedOrganizationContext
  | BrowserConsoleOrganizationRequiredContext
  | BrowserConsoleOrganizationUnavailableContext;

export type BrowserConsoleOrganizationIssue =
  | BrowserConsoleOrganizationRequiredContext
  | BrowserConsoleOrganizationUnavailableContext;

export interface BrowserConsoleSelectedOrganizationContext {
  kind: 'selected';
  selectedOrganizationSlug: string;
}

export interface BrowserConsoleOrganizationRequiredContext {
  kind: 'organization_required';
  requestedOrganizationSlug: null;
  selectedOrganizationSlug: null;
}

export interface BrowserConsoleOrganizationUnavailableContext {
  kind: 'organization_unavailable';
  requestedOrganizationSlug: string;
  selectedOrganizationSlug: null;
}
