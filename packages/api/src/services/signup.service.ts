import { z } from 'zod';
import type { ApiConfig } from '../config';
import {
  createEmailTakenError,
  createSignupDisabledError,
  createSignupIdempotencyConflictError,
  createSignupIdempotencyKeyExpiredError,
} from '../errors/api-business-error';
import { createId, hashToken } from '../lib/tokens';
import { createPrincipalWithExecutor, deletePrincipalWithExecutor } from '../queries/organization-users.query';
import type { OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import { listOrganizationRowsForPrincipal } from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { isUniqueConstraintError } from '../queries/query-error';
import {
  findSignupIdempotencyRecord,
  storeSignupIdempotencyKeyWithExecutor,
} from '../queries/signup-idempotency.query';
import type { SignupIdempotencyRecordRow } from '../queries/signup-idempotency.query.types';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import {
  buildAuthSessionOrganizationPolicySession,
  createPasswordAuthSessionInput,
  issueAuthSessionWithExecutor,
} from './auth-session.service';
import type { AuthSessionPlan } from './auth-session.types';
import { createOrganization } from './create-organization.service';
import type { CreateOrganizationResult } from './create-organization.service.types';
import type { SignupAccount, SignupInput, SignupResult } from './signup.service.types';

const generatedSignupEmailSubdomain: string = 'signup';
const generatedSignupEmailSchema: z.ZodString = z.string().email();

/**
 * A signup key stops being honoured a day after the account was created. The key is the only proof a retry comes from
 * the original caller, so a key that lived on forever would be a permanent way to mint sessions for that account, long
 * after any retry could plausibly need it.
 */
const signupIdempotencyKeyRetentionMs: number = 86_400_000;

/**
 * Signup writes an account, an organization, and a session, and a caller that loses the response has no session and no
 * way to obtain one. Every step is therefore keyed on the caller's idempotency key and skipped when it already ran, so
 * the same key always converges on the same account: the key and the principal are committed together, the
 * organization is created only while the account has none, and the session is minted fresh on every attempt rather
 * than stored and replayed.
 */
export async function signUp(input: SignupInput): Promise<SignupResult> {
  const config: ApiConfig = getApiConfig();
  if (!config.signupEnabled) {
    throw createSignupDisabledError();
  }

  const account: SignupAccount = await resolveSignupAccount(input, config);
  const organizations: OrganizationRow[] = await resolveSignupOrganizations(account, input.organizationName);
  const session: AuthSessionPlan = await issueSignupSession(account.principalId, config);

  return {
    authSession: buildAuthSessionOrganizationPolicySession(session, account.principalId),
    organizations,
    principalEmail: account.email,
    principalId: account.principalId,
    sessionExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}

async function resolveSignupAccount(input: SignupInput, config: ApiConfig): Promise<SignupAccount> {
  const keyHash: string = hashToken(input.idempotencyKey, config.sessionSecret);
  const requestHash: string = hashSignupRequest(input, config.sessionSecret);
  const record: SignupIdempotencyRecordRow | undefined = await findSignupIdempotencyRecord(keyHash);
  if (record !== undefined) {
    return readRetriedSignupAccount(record, requestHash);
  }

  try {
    return await createSignupAccount(input, keyHash, requestHash, config);
  } catch (error) {
    if (!isUniqueConstraintError(error as Error | undefined)) {
      throw error;
    }

    return await resolveRacedSignupAccount(keyHash, requestHash);
  }
}

/**
 * The insert lost a race on either the key or the email. A key row now proves a concurrent attempt with this key
 * committed first, so this attempt joins it instead of reporting the email its own rolled-back insert had taken.
 */
async function resolveRacedSignupAccount(keyHash: string, requestHash: string): Promise<SignupAccount> {
  const record: SignupIdempotencyRecordRow | undefined = await findSignupIdempotencyRecord(keyHash);
  if (record === undefined) {
    throw createEmailTakenError();
  }

  return readRetriedSignupAccount(record, requestHash);
}

function readRetriedSignupAccount(record: SignupIdempotencyRecordRow, requestHash: string): SignupAccount {
  if (Date.now() - record.createdAt.getTime() > signupIdempotencyKeyRetentionMs) {
    throw createSignupIdempotencyKeyExpiredError();
  }
  if (record.requestHash !== requestHash) {
    throw createSignupIdempotencyConflictError();
  }

  return { email: record.principalEmail, isNewAccount: false, principalId: record.principalId };
}

async function createSignupAccount(
  input: SignupInput,
  keyHash: string,
  requestHash: string,
  config: ApiConfig,
): Promise<SignupAccount> {
  const principalId: string = createId('prn');
  const email: string = input.email ?? buildGeneratedSignupEmail(principalId, config.baseDomain);

  await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<void> => {
    await createPrincipalWithExecutor(tx, { email, principalId });
    await storeSignupIdempotencyKeyWithExecutor(tx, { id: createId('sgnidem'), keyHash, principalId, requestHash });
  });

  return { email, isNewAccount: true, principalId };
}

async function resolveSignupOrganizations(
  account: SignupAccount,
  organizationName: string,
): Promise<OrganizationRow[]> {
  const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipal(account.principalId);
  if (organizations.length > 0) {
    return organizations;
  }

  return await createSignupOrganizations(account, organizationName);
}

/**
 * Two attempts under the same key can reach this point together, and the one that loses the name collides on the
 * organization slug. That failure is only real when the account still has no organization: otherwise the collision is
 * with the organization the other attempt just created for this very account, which is the result both callers wanted.
 */
async function createSignupOrganizations(account: SignupAccount, organizationName: string): Promise<OrganizationRow[]> {
  try {
    const created: CreateOrganizationResult = await createOrganization({
      name: organizationName,
      principalId: account.principalId,
    });
    return [created.organization];
  } catch (error) {
    const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipal(account.principalId);
    if (organizations.length > 0) {
      return organizations;
    }

    await discardSignupAccount(account);
    throw error;
  }
}

/**
 * Discarding frees the requested email address for an immediate retry under another organization name. Only the
 * request that created the account may do it: a retry that deleted the account here would destroy the work of the
 * concurrent attempt that is still creating the organization. Cleanup must also never replace the failure the caller
 * needs to see, so a failed discard leaves the account behind rather than turning a clean business error into a 500 —
 * the key makes that leftover account recoverable by the next retry.
 */
async function discardSignupAccount(account: SignupAccount): Promise<void> {
  if (!account.isNewAccount) {
    return;
  }

  try {
    await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<void> => {
      await deletePrincipalWithExecutor(tx, account.principalId);
    });
  } catch {
    return;
  }
}

/**
 * The session is unscoped like the one `compartment login` mints, so a signup session is never pinned to the first
 * organization forever.
 */
async function issueSignupSession(principalId: string, config: ApiConfig): Promise<AuthSessionPlan> {
  return await getApiDatabase().transaction(
    async (tx: OrganizationUsersTransaction): Promise<AuthSessionPlan> =>
      await issueAuthSessionWithExecutor(tx, createPasswordAuthSessionInput(principalId, null), config),
  );
}

/**
 * The fingerprint is what makes a reused key with a different email or organization name a conflict instead of a
 * silent hand-back of the first account.
 */
function hashSignupRequest(input: SignupInput, secret: string): string {
  return hashToken(JSON.stringify({ email: input.email ?? null, organizationName: input.organizationName }), secret);
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
