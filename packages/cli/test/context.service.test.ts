import { describe, expect, it, vi, type Mock } from 'vitest';
import type { OrganizationSummary } from '@compartment/contracts';
import type { CliOrganizationConfig } from '../src/store/config.types';
import {
  createAuthenticatedRequester,
  resolveOrganizationBySlug,
  selectLoginOrganization,
} from '../src/services/context.service';
import type { AuthenticatedContext } from '../src/services/context.types';

const createRequester: Mock = vi.hoisted((): Mock => vi.fn((): Mock => vi.fn()));

vi.mock('@compartment/sdk', async (importOriginal: () => Promise<object>): Promise<object> => {
  const original: object = await importOriginal();
  return { ...original, createCompartmentRequester: createRequester };
});

const organizations: OrganizationSummary[] = [
  {
    id: 'org_1',
    name: 'Acme',
    slug: 'acme',
  },
  {
    id: 'org_2',
    name: 'Finance',
    slug: 'finance',
  },
];

describe('organization context service', (): void => {
  it('resolves organizations by slug only', (): void => {
    expect(resolveOrganizationBySlug(organizations, 'finance').id).toBe('org_2');
    expect((): void => {
      resolveOrganizationBySlug(organizations, 'org_2');
    }).toThrow('Organization slug "org_2" was not found.');
  });

  it('matches configured organizations by slug only', (): void => {
    const configuredOrganization: CliOrganizationConfig = {
      id: 'org_old',
      name: 'Old Finance',
      slug: 'finance',
    };

    expect(selectLoginOrganization(organizations, configuredOrganization)?.id).toBe('org_2');
  });

  it('returns the only organization unchanged when only one is available', (): void => {
    expect(selectLoginOrganization([organizations[0]!])?.slug).toBe('acme');
  });

  it('can keep a server-bounded operation free of a shorter client deadline', (): void => {
    const context: AuthenticatedContext = {
      apiUrl: 'https://console.example',
      currentOrganization: { id: 'org_1', name: 'Acme', slug: 'acme' },
      remoteName: 'origin',
      sessionToken: 'session',
    };

    createAuthenticatedRequester(context, { includeCurrentOrganization: true, requestTimeoutMs: null });

    expect(createRequester).toHaveBeenLastCalledWith({
      apiUrl: 'https://console.example',
      currentOrganization: 'acme',
      requestTimeoutMs: null,
      sessionToken: 'session',
    });
  });
});
