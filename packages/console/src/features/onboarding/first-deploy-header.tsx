import type { JSX } from 'react';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { buttonVariants } from '../../components/ui/button';

export interface FirstDeployHeaderCopy {
  description?: string | null;
  eyebrow: string | null;
  secondaryActionLabel?: string | null;
  title: string;
}

interface FirstDeployHeaderProps {
  copy: FirstDeployHeaderCopy;
  hideBreadcrumbs: boolean;
  projectsHref: string;
}

export function FirstDeployHeader({
  copy,
  hideBreadcrumbs,
  projectsHref,
}: Readonly<FirstDeployHeaderProps>): JSX.Element {
  return (
    <header className="grid items-start gap-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0 text-left sm:mx-auto sm:max-w-2xl sm:text-center">
        {renderFirstDeployBreadcrumbs(copy, hideBreadcrumbs, projectsHref)}
        {copy.eyebrow === null ? null : (
          <p className="text-[12px] font-semibold uppercase text-[#707e0a]">{copy.eyebrow}</p>
        )}
        <h1 className="mt-3 text-[30px] font-semibold leading-9 text-[#111212]">{copy.title}</h1>
        {copy.description === undefined || copy.description === null ? null : (
          <p className="mt-3 text-[14px] leading-6 text-[#485259]">{copy.description}</p>
        )}
      </div>
      {renderFirstDeploySecondaryAction(copy, projectsHref)}
    </header>
  );
}

function renderFirstDeployBreadcrumbs(
  copy: Readonly<FirstDeployHeaderCopy>,
  hideBreadcrumbs: boolean,
  projectsHref: string,
): JSX.Element | null {
  if (hideBreadcrumbs) {
    return null;
  }

  return (
    <BrowserBreadcrumbs
      className="mb-3 sm:flex sm:justify-center"
      items={[{ href: projectsHref, label: 'Projects' }, { label: copy.title }]}
    />
  );
}

function renderFirstDeploySecondaryAction(
  copy: Readonly<FirstDeployHeaderCopy>,
  projectsHref: string,
): JSX.Element | null {
  if (copy.secondaryActionLabel === undefined || copy.secondaryActionLabel === null) {
    return null;
  }

  return (
    <BrowserSoftNavigationLink className={buttonVariants({ variant: 'outline' })} href={projectsHref}>
      {copy.secondaryActionLabel}
    </BrowserSoftNavigationLink>
  );
}
