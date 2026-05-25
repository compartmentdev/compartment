export interface SetPasswordResetTokenInput {
  passwordResetOrganizationId: string;
  passwordResetTokenExpiresAt: Date;
  passwordResetTokenHash: string;
  principalId: string;
  updatedAt: Date;
}

export interface CompletePasswordResetInput {
  passwordHash: string;
  passwordResetOrganizationId: string;
  passwordResetTokenHash: string;
  principalId: string;
  updatedAt: Date;
}
