import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';
import {
  createCustomDomainRequestSchema,
  createCustomDomainResponseSchema,
  listCustomDomainsQuerySchema,
  type CreateCustomDomainResponse,
} from '../src';
import { buildCreateCustomDomainResponse } from './schema-test.fixtures';
import { expectSchemaRejects } from './schema-test.helpers';

describe('custom domain contract', (): void => {
  it('accepts custom domain create responses', (): void => {
    const result: CreateCustomDomainResponse = createCustomDomainResponseSchema.parse(
      buildCreateCustomDomainResponse(),
    );

    expect(result.domain.host).toBe('app.example.com');
    expect(result.dnsRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: 'ownership', recordType: 'TXT' }),
        expect.objectContaining({ purpose: 'routing', recordType: 'CNAME' }),
      ]),
    );
  });

  it('rejects unsupported custom domain DNS record types', (): void => {
    const response: CreateCustomDomainResponse = buildCreateCustomDomainResponse();
    const result: SafeParseReturnType<CreateCustomDomainResponse, CreateCustomDomainResponse> =
      createCustomDomainResponseSchema.safeParse({
        dnsRecords: [
          {
            groupId: 'routing',
            name: 'example.com',
            purpose: 'routing',
            recordType: 'ALIAS',
            required: false,
            value: 'billing.example.com',
          },
        ],
        domain: response.domain,
      });

    expect(result.success).toBe(false);
  });

  it('rejects non-canonical project names across custom domain payloads', (): void => {
    expectSchemaRejects(createCustomDomainRequestSchema, {
      environmentName: 'production',
      host: 'app.example.com',
      projectName: 'Billing_App',
      serviceName: 'web',
    });
    expectSchemaRejects(listCustomDomainsQuerySchema, {
      projectName: 'Billing_App',
    });
    expectSchemaRejects(
      createCustomDomainResponseSchema,
      buildCreateCustomDomainResponse({
        domain: { projectName: 'Billing_App' },
      }),
    );
  });
});
