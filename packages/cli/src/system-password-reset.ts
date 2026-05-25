import {
  compartmentSystemIssuePasswordResetPathname,
  issuePasswordResetResponseSchema,
  type IssuePasswordResetResponse,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { createSystemCommandContext } from './system-api';
import { requestSystemApi } from './system-api-client';
import type { SystemApiClientConfig } from './system-api-client.types';

export async function issueSelfHostedPasswordReset(email: string): Promise<IssuePasswordResetResponse> {
  const context: { client: SystemApiClientConfig } = await createSystemCommandContext();

  return await requestSystemApi(context.client, {
    body: { email },
    method: 'POST',
    parse: (value: JsonValue | null): IssuePasswordResetResponse => issuePasswordResetResponseSchema.parse(value),
    path: compartmentSystemIssuePasswordResetPathname,
  });
}
