import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { OrganizationSelect } from '../../components/organization-select';
import { buttonVariants } from '../../components/ui/button';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import type { BrowserOrganizationOption } from '../../services/browser-organization.service.types';

interface BrowserConsoleOrganizationContextPanelProps {
  context: BrowserConsoleOrganizationIssue;
  onNavigate: BrowserSoftNavigateHandler;
  organizations: BrowserOrganizationOption[];
  readOrganizationHref: (organizationSlug: string) => string;
}

interface OrganizationContextCopy {
  description: string;
  title: string;
}

export function BrowserConsoleOrganizationContextPanel({
  context,
  onNavigate,
  organizations,
  readOrganizationHref,
}: Readonly<BrowserConsoleOrganizationContextPanelProps>): JSX.Element {
  const copy: OrganizationContextCopy = readOrganizationContextCopy(context, organizations.length);

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Organization context
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{copy.title}</h1>
          <p className="text-[14px] leading-6 text-muted-foreground">{copy.description}</p>
        </div>
        {renderOrganizationRecoveryAction(organizations, readOrganizationHref, onNavigate)}
      </div>
    </section>
  );
}

function readOrganizationContextCopy(
  context: BrowserConsoleOrganizationIssue,
  visibleOrganizationCount: number,
): OrganizationContextCopy {
  if (visibleOrganizationCount === 0) {
    return {
      description: 'Your session does not have access to any organizations.',
      title: 'No organizations available',
    };
  }

  if (context.kind === 'organization_unavailable') {
    return {
      description:
        'The organization in this URL is not available to your current session. Choose an organization you can access.',
      title: 'Organization unavailable',
    };
  }

  return {
    description: 'This page needs an organization before it can load. Choose an organization to continue.',
    title: 'Choose an organization',
  };
}

function renderOrganizationRecoveryAction(
  organizations: BrowserOrganizationOption[],
  readOrganizationHref: (organizationSlug: string) => string,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  if (organizations.length === 0) {
    return null;
  }

  return organizations.length === 1
    ? renderSingleOrganizationRecoveryAction(organizations[0]!, readOrganizationHref, onNavigate)
    : renderOrganizationSelectRecoveryAction(organizations, readOrganizationHref, onNavigate);
}

function renderSingleOrganizationRecoveryAction(
  organization: BrowserOrganizationOption,
  readOrganizationHref: (organizationSlug: string) => string,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <BrowserSoftNavigationLink
      className={buttonVariants({ size: 'sm' })}
      href={readOrganizationHref(organization.slug)}
      onNavigate={onNavigate}
    >
      Open {organization.name}
    </BrowserSoftNavigationLink>
  );
}

function renderOrganizationSelectRecoveryAction(
  organizations: BrowserOrganizationOption[],
  readOrganizationHref: (organizationSlug: string) => string,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <OrganizationSelect
      onChange={(organizationSlug: string): void => {
        onNavigate(readOrganizationHref(organizationSlug));
      }}
      organizations={organizations}
      value={null}
    />
  );
}
