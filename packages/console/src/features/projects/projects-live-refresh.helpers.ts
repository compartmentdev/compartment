import type { BrowserProjectsPageResult } from '../../services/browser-projects.service.types';

export function shouldRefreshProjectsPage(data: BrowserProjectsPageResult): boolean {
  return data.archiveState !== 'archived' && data.projects.length > 0;
}
