import { describe, expect, it } from 'vitest';
import { appAccessExchangeResponseSchema, type AppAccessExchangeResponse } from '../src';

describe('app-access contract', (): void => {
  it('accepts safe app-relative exchange redirect paths', (): void => {
    expect(
      appAccessExchangeResponseSchema.safeParse(createAppAccessExchangeResponse('/dashboard?tab=activity')).success,
    ).toBe(true);
  });

  it('rejects absolute, protocol-relative, and traversal redirect paths', (): void => {
    expect(
      appAccessExchangeResponseSchema.safeParse(createAppAccessExchangeResponse('https://evil.example')).success,
    ).toBe(false);
    expect(appAccessExchangeResponseSchema.safeParse(createAppAccessExchangeResponse('//evil.example')).success).toBe(
      false,
    );
    expect(appAccessExchangeResponseSchema.safeParse(createAppAccessExchangeResponse('/%2e%2e/admin')).success).toBe(
      false,
    );
    expect(
      appAccessExchangeResponseSchema.safeParse(createAppAccessExchangeResponse('/safe%2fdashboard')).success,
    ).toBe(false);
  });
});

function createAppAccessExchangeResponse(redirectPath: string): AppAccessExchangeResponse {
  return {
    appSessionToken: 'app-session-token',
    redirectPath,
    session: {
      authSessionId: 'ses_123',
      expiresAt: '2099-04-21T11:00:00.000Z',
      host: 'billing.localhost',
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      principalType: 'user',
    },
  };
}
