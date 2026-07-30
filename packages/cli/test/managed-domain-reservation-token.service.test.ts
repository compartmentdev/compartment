import { describe, expect, it } from 'vitest';
import { readManagedDomainReservationToken } from '../src/services/managed-domain-reservation-token.service';

const emptyEnvironment: NodeJS.ProcessEnv = {};

describe('managed-domain reservation authorization', (): void => {
  it('returns no authorization when the environment variable is absent', (): void => {
    expect(readManagedDomainReservationToken(emptyEnvironment)).toBeUndefined();
  });

  it('treats blank authorization as absent', (): void => {
    expect(
      readManagedDomainReservationToken({
        COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN: '   ',
      }),
    ).toBeUndefined();
  });

  it('returns configured reservation authorization unchanged', (): void => {
    expect(
      readManagedDomainReservationToken({
        COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN: ' reservation-token ',
      }),
    ).toBe(' reservation-token ');
  });
});
