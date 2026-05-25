import type { ProjectListResponse } from '@compartment/contracts/browser';

export type BrowserProjectOverviewListResponse = Extract<ProjectListResponse, { detail: 'overview' }>;

export function requireProjectOverviewListResponse(response: ProjectListResponse): BrowserProjectOverviewListResponse {
  if (response.detail === 'overview') {
    return response;
  }

  throw new Error('Expected project overview list response.');
}
