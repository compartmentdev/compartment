import type {
  DefaultTimestampBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredTextBuilder,
  RequiredTimestampBuilder,
} from './schema.shared.types';

interface BrowserAuthTokenFlowsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  kind: RequiredTextBuilder<'kind'>;
  tokenCiphertext: RequiredTextBuilder<'token_ciphertext'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  consumedAt: OptionalTimestampBuilder<'consumed_at'>;
}

export type BrowserAuthTokenFlowsTable = PgTableOf<'browser_auth_token_flows', BrowserAuthTokenFlowsColumnBuilders>;
export type BrowserAuthTokenFlowsExtraConfigColumns = PgExtraConfigColumnsOf<
  'browser_auth_token_flows',
  BrowserAuthTokenFlowsColumnBuilders
>;
