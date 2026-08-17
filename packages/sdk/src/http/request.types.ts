import type { ZodType } from 'zod';

export type CompartmentRequestMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export interface CompartmentRequestOptions<TResult, TBody> {
  body?: TBody | undefined;
  currentOrganization?: string | undefined;
  idempotencyKey?: string | undefined;
  method: CompartmentRequestMethod;
  path: string;
  schema: ZodType<TResult>;
  sessionToken?: string | undefined;
}

export interface CompartmentBinaryRequestOptions {
  currentOrganization?: string | undefined;
  method: CompartmentRequestMethod;
  path: string;
  sessionToken?: string | undefined;
}

export interface CompartmentBinaryRequestExecution {
  execute: () => Promise<Buffer>;
  maximumAttempts: number;
  method: CompartmentRequestMethod;
  path: string;
  url: string;
}

export interface CompartmentBinaryRequestRetryOptions {
  maximumAttempts: number;
}

export interface CompartmentRawRequestOptions<TResult> {
  body: Buffer | Uint8Array;
  contentType: string;
  currentOrganization?: string | undefined;
  method: CompartmentRequestMethod;
  path: string;
  schema: ZodType<TResult>;
  sessionToken?: string | undefined;
}

export interface CompartmentRequestErrorFields {
  code: string;
  method: CompartmentRequestMethod;
  requestId?: string | undefined;
  statusCode: number;
  url: string;
}

export interface CompartmentRequestErrorCandidate extends Partial<CompartmentRequestErrorFields> {
  name?: string | undefined;
}

export type CompartmentRequester = <TResult, TBody>(
  options: CompartmentRequestOptions<TResult, TBody>,
) => Promise<TResult>;

export type CompartmentBinaryRequester = (options: CompartmentBinaryRequestOptions) => Promise<Buffer>;
export type CompartmentRawRequester = <TResult>(options: CompartmentRawRequestOptions<TResult>) => Promise<TResult>;

export type CompartmentRequestSchema<TResult> = ZodType<TResult>;
