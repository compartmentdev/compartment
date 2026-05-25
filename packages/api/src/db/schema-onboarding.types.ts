import type {
  DefaultTimestampBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface OnboardingFirstDeploySessionsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  createdByPrincipalId: RequiredTextBuilder<'created_by_principal_id'>;
  state: RequiredTextBuilder<'state'>;
  method: OptionalTextBuilder<'method'>;
  skippedAt: OptionalTimestampBuilder<'skipped_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type OnboardingFirstDeploySessionsTable = PgTableOf<
  'onboarding_first_deploy_sessions',
  OnboardingFirstDeploySessionsColumnBuilders
>;
export type OnboardingFirstDeploySessionsExtraConfigColumns = PgExtraConfigColumnsOf<
  'onboarding_first_deploy_sessions',
  OnboardingFirstDeploySessionsColumnBuilders
>;
