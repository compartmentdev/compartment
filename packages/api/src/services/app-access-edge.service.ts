import { setTimeout as sleep } from 'node:timers/promises';
import {
  compartmentInternalAppAccessSessionsRevokePathname,
  compartmentInternalAppAccessStatePathname,
  edgeInvalidateAppSessionsRequestSchema,
  type AppAccessStateResponse,
  type EdgeInvalidateAppSessionsRequest,
} from '@compartment/contracts';
import { createEdgeStateUpdateFailedError } from '../errors/api-business-error';
import { buildAppAccessStateResponse } from '../lib/app-access-state-response';
import { getApiConfig } from '../runtime/runtime-access';
import { readAppAccessState } from './app-access-state.service';
import type { EdgeRequestError } from './app-access-edge.service.types';
import { fetchEdgeInternalHttp } from './outbound-http.service';

const edgeRequestAttemptCount: number = 10;
const edgeRequestRetryDelayMs: number = 500;

export async function synchronizeEdgeAppAccessState(): Promise<void> {
  const payload: AppAccessStateResponse = buildAppAccessStateResponse(await readAppAccessState());

  await sendEdgeRequest(compartmentInternalAppAccessStatePathname, 'PUT', payload);
}

export async function invalidateEdgeAppAccessSessions(authSessionId: string): Promise<void> {
  const payload: EdgeInvalidateAppSessionsRequest = edgeInvalidateAppSessionsRequestSchema.parse({
    authSessionId,
  });

  await sendEdgeRequest(compartmentInternalAppAccessSessionsRevokePathname, 'POST', payload);
}

async function sendEdgeRequest(path: string, method: 'POST' | 'PUT', body: object): Promise<void> {
  for (let attempt: number = 1; attempt <= edgeRequestAttemptCount; attempt += 1) {
    try {
      await sendSingleEdgeRequest(path, method, body);

      return;
    } catch (error) {
      if (!(error instanceof Error) || attempt === edgeRequestAttemptCount || !isRetryableEdgeRequestError(error)) {
        throw createEdgeStateUpdateFailedError();
      }

      await waitForNextEdgeRequestAttempt();
    }
  }
}

async function sendSingleEdgeRequest(path: string, method: 'POST' | 'PUT', body: object): Promise<void> {
  const response: Response = await fetchEdgeInternalHttp(path, {
    body: JSON.stringify(body),
    headers: createEdgeRequestHeaders(),
    method,
  });
  if (!response.ok) {
    const error: EdgeRequestError = new Error(
      `Edge app access request failed with status ${response.status.toString()}.`,
    );
    error.statusCode = response.status;

    throw error;
  }
}

function createEdgeRequestHeaders(): Headers {
  return new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${getApiConfig().edgeToken}`,
    'Content-Type': 'application/json',
  });
}

function isRetryableEdgeRequestError(error: Error): boolean {
  const typedError: EdgeRequestError = error;
  if (typeof typedError.statusCode === 'number') {
    return typedError.statusCode >= 500;
  }

  return true;
}

async function waitForNextEdgeRequestAttempt(): Promise<void> {
  await sleep(edgeRequestRetryDelayMs);
}
