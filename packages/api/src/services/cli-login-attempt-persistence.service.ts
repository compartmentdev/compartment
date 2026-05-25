import { createCliLoginAttempt, deleteStaleCliLoginAttempts } from '../queries/cli-login.query';
import { hashCliLoginSecret, type CliLoginAttemptPlan } from './cli-login.service.helpers';

export async function persistCliLoginAttemptPlan(
  plan: CliLoginAttemptPlan,
  now: Date,
  onboardingSessionId: string | null,
): Promise<void> {
  await deleteStaleCliLoginAttempts(now);
  await createCliLoginAttempt({
    browserCodeHash: hashCliLoginSecret(plan.browserCode),
    exchangeSecretHash: hashCliLoginSecret(plan.exchangeSecret),
    expectedPrincipalEmail: plan.expectedPrincipalEmail,
    expiresAt: plan.expiresAt,
    id: plan.attemptId,
    onboardingSessionId,
    organizationId: plan.organizationId,
  });
}
