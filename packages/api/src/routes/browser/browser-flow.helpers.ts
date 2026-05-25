import {
  appAccessBrowserFlowTargetSchema,
  appAccessFlowStateSchema,
  compartmentSessionCookieName,
  type AppAccessBrowserFlowTarget,
} from '@compartment/contracts';
import { appendOptionalSearchParam, readCookieValue } from '@compartment/utils';
import type { FastifyRequest } from 'fastify';
import { z, type SafeParseReturnType } from 'zod';
import { browserLoginSuccessRedirectSearchParamName } from '../../browser-public-paths';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import type { BrowserFlowFields, BrowserFlowTargetOrNull, BrowserSsoQuery } from './browser-flow.types';

interface BrowserFlowFieldSchemaShape {
  host: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
  state: z.ZodOptional<typeof appAccessFlowStateSchema>;
}

export const browserSsoQuerySchema: z.ZodType<BrowserSsoQuery> = z.object({
  ...createBrowserFlowFieldSchemaShape(),
  provider: z.string().min(1).optional(),
  [browserLoginSuccessRedirectSearchParamName]: z.string().min(1).optional(),
});

export function createBrowserFlowFieldSchemaShape(): BrowserFlowFieldSchemaShape {
  return {
    host: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    state: appAccessFlowStateSchema.optional(),
  };
}

export function appendBrowserFlowSearchParams(
  searchParams: URLSearchParams,
  flowFields: BrowserFlowFields | null,
): void {
  if (flowFields === null) {
    return;
  }
  appendOptionalSearchParam(searchParams, 'host', flowFields.host);
  appendOptionalSearchParam(searchParams, 'path', flowFields.path);
  appendOptionalSearchParam(searchParams, 'state', flowFields.state);
}

export function readFlowTarget(input: BrowserFlowFields): BrowserFlowTargetOrNull {
  const hasAnyValue: boolean = input.host !== undefined || input.path !== undefined || input.state !== undefined;
  const hasAllValues: boolean = input.host !== undefined && input.path !== undefined && input.state !== undefined;
  if (!hasAnyValue) {
    return null;
  }
  if (!hasAllValues) {
    throw createInvalidBrowserFlowError();
  }

  return parseBrowserFlowTarget({
    host: input.host ?? failMissingFlowValue(),
    path: input.path ?? failMissingFlowValue(),
    state: input.state ?? failMissingFlowValue(),
  });
}

export function readCompartmentSessionToken(request: FastifyRequest): string | undefined {
  return readCookieValue(request.headers.cookie, compartmentSessionCookieName);
}

function failMissingFlowValue(): never {
  throw createInvalidBrowserFlowError();
}

function parseBrowserFlowTarget(input: AppAccessBrowserFlowTarget): AppAccessBrowserFlowTarget {
  const parseResult: SafeParseReturnType<AppAccessBrowserFlowTarget, AppAccessBrowserFlowTarget> =
    appAccessBrowserFlowTargetSchema.safeParse(input);
  if (!parseResult.success) {
    throw createInvalidBrowserFlowError();
  }

  return parseResult.data;
}

function createInvalidBrowserFlowError(): ApiBoundaryError {
  return new ApiBoundaryError(400, 'invalid_browser_flow', 'A valid browser flow target is required.');
}
