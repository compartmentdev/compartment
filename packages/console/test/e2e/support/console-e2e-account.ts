import { readRequiredEnvironmentValue } from './console-e2e-runtime';

export interface ConsoleE2eAccount {
  email: string;
  organizationName: string;
  organizationSlug: string;
  password: string;
}

export function readConsoleE2eAccount(): ConsoleE2eAccount {
  return {
    email: readRequiredEnvironmentValue('COMPARTMENT_E2E_EMAIL'),
    organizationName: readRequiredEnvironmentValue('COMPARTMENT_E2E_ORGANIZATION_NAME'),
    organizationSlug: readRequiredEnvironmentValue('COMPARTMENT_E2E_ORGANIZATION_SLUG'),
    password: readRequiredEnvironmentValue('COMPARTMENT_E2E_PASSWORD'),
  };
}

export function readConsoleE2eAdminAccount(): ConsoleE2eAccount {
  return {
    email: readRequiredEnvironmentValue('COMPARTMENT_E2E_ADMIN_EMAIL'),
    organizationName: readRequiredEnvironmentValue('COMPARTMENT_E2E_ORGANIZATION_NAME'),
    organizationSlug: readRequiredEnvironmentValue('COMPARTMENT_E2E_ORGANIZATION_SLUG'),
    password: readRequiredEnvironmentValue('COMPARTMENT_E2E_ADMIN_PASSWORD'),
  };
}
