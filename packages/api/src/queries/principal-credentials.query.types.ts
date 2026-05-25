import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { localCredentials, principals } from '../db/schema';

export interface PrincipalCredentialSelection extends SelectedFields {
  bootstrapTokenExpiresAt: typeof localCredentials.bootstrapTokenExpiresAt;
  bootstrapTokenHash: typeof localCredentials.bootstrapTokenHash;
  credentialPrincipalId: typeof localCredentials.principalId;
  email: typeof principals.email;
  passwordHash: typeof localCredentials.passwordHash;
  passwordResetOrganizationId: typeof localCredentials.passwordResetOrganizationId;
  passwordResetTokenExpiresAt: typeof localCredentials.passwordResetTokenExpiresAt;
  passwordResetTokenHash: typeof localCredentials.passwordResetTokenHash;
  principalId: typeof principals.id;
  principalType: typeof principals.type;
}
