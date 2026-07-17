import {
  compartmentSystemIssuePasswordResetPathname,
  issuePasswordResetResponseSchema,
  type IssuePasswordResetRequest,
  type IssuePasswordResetResponse,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';
import { requestKubernetesSystemApi } from './kubernetes-system-api.service';

export async function issueKubernetesPasswordReset(
  target: KubernetesOperatorTarget,
  email: string,
): Promise<IssuePasswordResetResponse> {
  const body: IssuePasswordResetRequest = { email };
  return await requestKubernetesSystemApi(
    target,
    { body, method: 'POST', path: compartmentSystemIssuePasswordResetPathname },
    (value: JsonValue | null): IssuePasswordResetResponse => issuePasswordResetResponseSchema.parse(value),
  );
}
