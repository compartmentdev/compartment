import type { BrowserConsoleOrganizationContext } from '../../services/browser-organization-context.service.types';
import type { BrowserOrganizationOption } from '../../services/browser-organization.service.types';

export interface OnboardingPageData {
  flowSearch: string;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  projectsHref: string;
  principalEmail: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
}
