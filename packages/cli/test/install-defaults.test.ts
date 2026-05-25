import { describe, expect, it } from 'vitest';
import { deriveRegisterOrganizationName } from '../src/prompts/install-defaults';

describe('deriveRegisterOrganizationName', (): void => {
  it('derives organization name from a company domain', (): void => {
    expect(deriveRegisterOrganizationName('owner@acme-dev.com')).toBe('Acme Dev');
  });

  it('uses the registrable label for compound country suffixes', (): void => {
    expect(deriveRegisterOrganizationName('owner@team.acme.co.uk')).toBe('Acme');
  });

  it('does not suggest an organization for common mailbox domains', (): void => {
    expect(deriveRegisterOrganizationName('owner@gmail.com')).toBeUndefined();
    expect(deriveRegisterOrganizationName('owner@example.com')).toBeUndefined();
  });
});
