import { expect } from 'vitest';
import type { OrganizationSummary, WhoAmICommandResponse } from '@compartment/contracts';

export function expectCurrentOrganizationSlug(payload: WhoAmICommandResponse, expectedSlug: string): void {
  const currentOrganization: OrganizationSummary | null = payload.currentOrganization;
  if (currentOrganization === null) {
    throw new Error('Expected a selected current organization in this CLI flow.');
  }

  expect(currentOrganization.slug).toBe(expectedSlug);
}
