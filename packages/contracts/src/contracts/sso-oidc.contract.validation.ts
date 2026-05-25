import { z } from 'zod';

interface SsoOidcProviderMutationValidationInput {
  buttonText?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  displayName?: string | undefined;
  identityVerification?: object | undefined;
  issuerUrl?: string | undefined;
  key?: string | undefined;
  preset?: 'generic' | 'google' | undefined;
  provisioning?: object | undefined;
  scope?: string | undefined;
}

export function validateCreateSsoOidcProviderMutation(
  value: SsoOidcProviderMutationValidationInput,
  context: z.RefinementCtx,
  requiredOidcScope: string,
): void {
  validateGenericOidcProviderMutation(value, context);
  validateOidcScope(value.scope, context, requiredOidcScope);
}

export function validateUpdateSsoOidcProviderMutation(
  value: SsoOidcProviderMutationValidationInput,
  context: z.RefinementCtx,
  requiredOidcScope: string,
): void {
  validateSsoOidcProviderUpdateHasChanges(value, context);
  validateOidcScope(value.scope, context, requiredOidcScope);
}

function validateGenericOidcProviderMutation(
  value: SsoOidcProviderMutationValidationInput,
  context: z.RefinementCtx,
): void {
  if (value.preset !== 'generic') {
    return;
  }
  if (value.issuerUrl === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Generic OIDC providers require issuerUrl.',
      path: ['issuerUrl'],
    });
  }
  if (value.displayName === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Generic OIDC providers require displayName.',
      path: ['displayName'],
    });
  }
}

function validateOidcScope(scope: string | undefined, context: z.RefinementCtx, requiredOidcScope: string): void {
  if (scope === undefined || hasOidcScope(scope, requiredOidcScope)) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'OIDC provider scope must include openid.',
    path: ['scope'],
  });
}

function validateSsoOidcProviderUpdateHasChanges(
  value: SsoOidcProviderMutationValidationInput,
  context: z.RefinementCtx,
): void {
  if (hasSsoOidcProviderUpdateChanges(value)) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'OIDC provider updates require at least one changed field.',
    path: [],
  });
}

export function hasSsoOidcProviderUpdateChanges(value: SsoOidcProviderMutationValidationInput): boolean {
  return (
    value.buttonText !== undefined ||
    value.clientId !== undefined ||
    value.clientSecret !== undefined ||
    value.displayName !== undefined ||
    value.identityVerification !== undefined ||
    value.issuerUrl !== undefined ||
    value.key !== undefined ||
    value.preset !== undefined ||
    value.provisioning !== undefined ||
    value.scope !== undefined
  );
}

function hasOidcScope(scope: string, expectedScope: string): boolean {
  return scope.split(/\s+/u).includes(expectedScope);
}
