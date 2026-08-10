import { z } from 'zod';
import type { ApiConfig } from '../config';
import { createEmailTakenError, createSignupDisabledError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { createPrincipalWithExecutor, deletePrincipalWithExecutor } from '../queries/organization-users.query';
import type { OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { isUniqueConstraintError } from '../queries/query-error';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import {
  buildAuthSessionOrganizationPolicySession,
  createPasswordAuthSessionInput,
  issueAuthSessionWithExecutor,
} from './auth-session.service';
import type { AuthSessionPlan } from './auth-session.types';
import { createOrganization } from './create-organization.service';
import type { CreateOrganizationResult } from './create-organization.service.types';
import type { SignupInput, SignupResult } from './signup.service.types';

const generatedSignupEmailSubdomain: string = 'signup';
const generatedSignupEmailSchema: z.ZodString = z.string().email();

/**
 * The account and its session are committed together, before the organization, so there is exactly one window where a
 * failure can leave state behind. `createOrganization` owns its own transaction and stays untouched, so that window is
 * closed by discarding the account instead: the session row cascades with it and the requested email address stays
 * free for an immediate retry under another organization name.
 */
export async function signUp(input: SignupInput): Promise<SignupResult> {
  const config: ApiConfig = getApiConfig();
  if (!config.signupEnabled) {
    throw createSignupDisabledError();
  }

  const principalId: string = createId('prn');
  const email: string = input.email ?? buildGeneratedSignupEmail(principalId, config.baseDomain);
  const session: AuthSessionPlan = await createSignupAccount(principalId, email, config);
  const organization: OrganizationRow = await createSignupOrganization(principalId, input.organizationName);

  return {
    authSession: buildAuthSessionOrganizationPolicySession(session, principalId),
    organizations: [organization],
    principalEmail: email,
    principalId,
    sessionExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}

async function createSignupAccount(principalId: string, email: string, config: ApiConfig): Promise<AuthSessionPlan> {
  try {
    return await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<AuthSessionPlan> => {
      await createPrincipalWithExecutor(tx, { email, principalId });
      return await issueAuthSessionWithExecutor(tx, createPasswordAuthSessionInput(principalId, null), config);
    });
  } catch (error) {
    if (isUniqueConstraintError(error as Error | undefined)) {
      throw createEmailTakenError();
    }

    throw error;
  }
}

async function createSignupOrganization(principalId: string, organizationName: string): Promise<OrganizationRow> {
  try {
    const created: CreateOrganizationResult = await createOrganization({ name: organizationName, principalId });
    return created.organization;
  } catch (error) {
    await discardSignupAccount(principalId);
    throw error;
  }
}

/**
 * Cleanup must never replace the failure the caller needs to see, so a failed discard leaves the account behind rather
 * than turning a clean business error into a 500.
 */
async function discardSignupAccount(principalId: string): Promise<void> {
  try {
    await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<void> => {
      await deletePrincipalWithExecutor(tx, principalId);
    });
  } catch {
    return;
  }
}

/**
 * The reserved `signup.` label keeps generated identities out of the mailbox namespace an operator may run on the base
 * domain, and validating here fails a misconfigured base domain before anything is written.
 */
function buildGeneratedSignupEmail(principalId: string, baseDomain: string): string {
  const email: string = `${principalId}@${generatedSignupEmailSubdomain}.${baseDomain}`;
  if (!generatedSignupEmailSchema.safeParse(email).success) {
    throw new Error(`COMPARTMENT_BASE_DOMAIN must be able to form an email address. Signup generated "${email}".`);
  }

  return email;
}
