import { z } from 'zod';
import type { ApiConfig } from '../config';
import { createSignupDisabledError, createEmailTakenError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { createPrincipalWithExecutor, deletePrincipalWithExecutor } from '../queries/organization-users.query';
import type { OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { isUniqueConstraintError } from '../queries/query-error';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import {
  buildAuthSessionOrganizationPolicySession,
  createScopedPasswordAuthSessionInput,
  issueAuthSessionWithExecutor,
} from './auth-session.service';
import type { AuthSessionPlan } from './auth-session.types';
import { createOrganization } from './create-organization.service';
import type { CreateOrganizationResult } from './create-organization.service.types';
import type { SignupInput, SignupResult } from './signup.service.types';

const generatedSignupEmailSubdomain: string = 'signup';
const generatedSignupEmailSchema: z.ZodString = z.string().email();

export async function signUp(input: SignupInput): Promise<SignupResult> {
  const config: ApiConfig = getApiConfig();
  if (!config.signupEnabled) {
    throw createSignupDisabledError();
  }

  const principalId: string = createId('prn');
  const email: string = input.email ?? buildGeneratedSignupEmail(principalId, config.baseDomain);

  await createSignupPrincipal(principalId, email);
  const organization: OrganizationRow = await createSignupOrganization(principalId, input.organizationName);

  return await issueSignupSession(principalId, email, organization, config);
}

/**
 * `createOrganization` owns its own transaction, so the principal is already committed when it runs. Discarding the
 * principal on failure keeps the requested email address free for an immediate retry with another organization name.
 */
async function createSignupOrganization(principalId: string, organizationName: string): Promise<OrganizationRow> {
  try {
    const created: CreateOrganizationResult = await createOrganization({ name: organizationName, principalId });
    return created.organization;
  } catch (error) {
    await discardSignupPrincipal(principalId);
    throw error;
  }
}

/**
 * Cleanup must never replace the failure the caller needs to see, so a failed discard leaves the orphan behind rather
 * than turning a clean business error into a 500.
 */
async function discardSignupPrincipal(principalId: string): Promise<void> {
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

async function createSignupPrincipal(principalId: string, email: string): Promise<void> {
  try {
    await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<void> => {
      await createPrincipalWithExecutor(tx, { email, principalId });
    });
  } catch (error) {
    if (isUniqueConstraintError(error as Error | undefined)) {
      throw createEmailTakenError();
    }

    throw error;
  }
}

async function issueSignupSession(
  principalId: string,
  email: string,
  organization: OrganizationRow,
  config: ApiConfig,
): Promise<SignupResult> {
  const session: AuthSessionPlan = await getApiDatabase().transaction(
    async (tx: OrganizationUsersTransaction): Promise<AuthSessionPlan> =>
      await issueAuthSessionWithExecutor(
        tx,
        createScopedPasswordAuthSessionInput(principalId, organization.id),
        config,
      ),
  );

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
