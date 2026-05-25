import type { ZodType } from 'zod';

export type CompartmentRequestMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';

export interface CompartmentRequestOptions<TResult, TBody> {
  body?: TBody | undefined;
  currentOrganization?: string | undefined;
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
  statusCode: number;
}

export type CompartmentRequester = <TResult, TBody>(
  options: CompartmentRequestOptions<TResult, TBody>,
) => Promise<TResult>;

export type CompartmentBinaryRequester = (options: CompartmentBinaryRequestOptions) => Promise<Buffer>;
export type CompartmentRawRequester = <TResult>(options: CompartmentRawRequestOptions<TResult>) => Promise<TResult>;

export type CompartmentRequestSchema<TResult> = ZodType<TResult>;
