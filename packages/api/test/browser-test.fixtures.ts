import type { AppAccessBrowserFlowTarget } from '@compartment/contracts';
import type { BrowserCompartmentSession } from '../src/services/app-access.service.types';

export function createBrowserCompartmentSession(): BrowserCompartmentSession {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    },
    expiresAt: new Date('2099-03-31T00:00:00.000Z'),
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    sessionId: 'ses_123',
    sessionToken: 'session-token',
  };
}

export function createBrowserFlowTarget(): AppAccessBrowserFlowTarget {
  return {
    host: 'billing.apps.localhost',
    path: '/dashboard',
    state: 'flow',
  };
}
