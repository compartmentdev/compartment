import { describe, expect, it } from 'vitest';
import {
  assertManagedDomainOnboardingAvailable,
  readManagedDomainReservationToken,
} from '../src/services/managed-domain-reservation-token.service';

const emptyEnvironment: NodeJS.ProcessEnv = {};

describe('managed-domain onboarding authorization', (): void => {
  it('explains public onboarding and the operator-domain alternative at the early boundary', (): void => {
    expect((): void => assertManagedDomainOnboardingAvailable(emptyEnvironment)).toThrow(
      'Managed Compartment domains require onboarding through the public installer.',
    );

    try {
      assertManagedDomainOnboardingAvailable(emptyEnvironment);
    } catch (error) {
      const message: string = error instanceof Error ? error.message : '';
      expect(message).toContain('curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-install');
      expect(message).toContain('choose domain option 2');
      expect(message).not.toContain('COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN');
    }
  });

  it('gives resume and rollback guidance if authorization disappears later', (): void => {
    expect((): string => readManagedDomainReservationToken(emptyEnvironment)).toThrow(
      'The namespace and foundation Helm release may already exist.',
    );

    try {
      readManagedDomainReservationToken(emptyEnvironment);
    } catch (error) {
      const message: string = error instanceof Error ? error.message : '';
      expect(message).toContain('using the same context, namespace, and release');
      expect(message).toContain('helm uninstall <release> --namespace <namespace> --kube-context <context>');
      expect(message).toContain('kubectl --context <context> delete namespace <namespace>');
      expect(message).not.toContain('COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN');
    }
  });

  it('returns onboarding authorization without exposing it', (): void => {
    expect(
      readManagedDomainReservationToken({
        COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN: 'reservation-token',
      }),
    ).toBe('reservation-token');
  });
});
