import { buildBrowserProjectOverviewPathname } from '../../browser-public-paths';
import { appendBrowserProjectHrefSearch } from './project-href-query';

interface BrowserProjectOverviewHrefInput {
  environmentName: string | null;
  organizationSlug: string | null;
  projectName: string;
}

export function buildProjectOverviewHref(input: Readonly<BrowserProjectOverviewHrefInput>): string {
  const pathname: string = buildBrowserProjectOverviewPathname(input.projectName);
  return appendBrowserProjectHrefSearch(pathname, input);
}
