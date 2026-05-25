import { and, eq, isNotNull, isNull, lte, or, gt, sql } from 'drizzle-orm';
import { browserAuthTokenFlows } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  BrowserAuthTokenFlowKind,
  BrowserAuthTokenFlowRow,
  CreateBrowserAuthTokenFlowInput,
  DeleteStaleBrowserAuthTokenFlowsBatchInput,
  PersistedBrowserAuthTokenFlowRow,
} from './browser-auth-token-flow.query.types';

interface DeleteStaleBrowserAuthTokenFlowsBatchResult {
  rows: object[];
}

export async function createBrowserAuthTokenFlow(input: CreateBrowserAuthTokenFlowInput): Promise<void> {
  await getApiDatabase().insert(browserAuthTokenFlows).values(input);
}

export async function findActiveBrowserAuthTokenFlow(
  flowId: string,
  kind: BrowserAuthTokenFlowKind,
  now: Date,
): Promise<BrowserAuthTokenFlowRow | undefined> {
  const rows: PersistedBrowserAuthTokenFlowRow[] = await getApiDatabase()
    .select()
    .from(browserAuthTokenFlows)
    .where(
      and(
        eq(browserAuthTokenFlows.id, flowId),
        eq(browserAuthTokenFlows.kind, kind),
        isNull(browserAuthTokenFlows.consumedAt),
        gt(browserAuthTokenFlows.expiresAt, now),
      ),
    )
    .limit(1);

  return toBrowserAuthTokenFlowRow(rows[0]);
}

export async function consumeBrowserAuthTokenFlow(
  flowId: string,
  kind: BrowserAuthTokenFlowKind,
  consumedAt: Date,
): Promise<void> {
  await getApiDatabase()
    .update(browserAuthTokenFlows)
    .set({ consumedAt })
    .where(
      and(
        eq(browserAuthTokenFlows.id, flowId),
        eq(browserAuthTokenFlows.kind, kind),
        isNull(browserAuthTokenFlows.consumedAt),
      ),
    );
}

export async function deleteStaleBrowserAuthTokenFlows(now: Date): Promise<void> {
  await getApiDatabase()
    .delete(browserAuthTokenFlows)
    .where(or(lte(browserAuthTokenFlows.expiresAt, now), isNotNull(browserAuthTokenFlows.consumedAt)));
}

export async function deleteStaleBrowserAuthTokenFlowsBatch(
  input: DeleteStaleBrowserAuthTokenFlowsBatchInput,
): Promise<number> {
  const result: DeleteStaleBrowserAuthTokenFlowsBatchResult = await getApiDatabase().execute(sql`
    WITH stale_browser_auth_token_flows AS (
      SELECT ${browserAuthTokenFlows.id}
      FROM ${browserAuthTokenFlows}
      WHERE ${browserAuthTokenFlows.expiresAt} <= ${input.now}
        OR ${browserAuthTokenFlows.consumedAt} IS NOT NULL
      ORDER BY ${browserAuthTokenFlows.expiresAt} ASC, ${browserAuthTokenFlows.id} ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM ${browserAuthTokenFlows}
    USING stale_browser_auth_token_flows
    WHERE ${browserAuthTokenFlows.id} = stale_browser_auth_token_flows.id
    RETURNING ${browserAuthTokenFlows.id}
  `);

  return result.rows.length;
}

function toBrowserAuthTokenFlowRow(
  row: PersistedBrowserAuthTokenFlowRow | undefined,
): BrowserAuthTokenFlowRow | undefined {
  if (row === undefined) {
    return undefined;
  }

  return {
    ...row,
    kind: readBrowserAuthTokenFlowKind(row.kind),
  };
}

function readBrowserAuthTokenFlowKind(kind: string): BrowserAuthTokenFlowKind {
  if (kind === 'activation' || kind === 'password_reset') {
    return kind;
  }

  throw new Error(`Unsupported browser auth token flow kind "${kind}".`);
}
