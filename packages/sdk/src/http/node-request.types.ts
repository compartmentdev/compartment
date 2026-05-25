import type { ZodType } from 'zod';

export type NodeRequestMethod = 'GET' | 'POST';

export interface NodeRequestOptions<TResult, TBody> {
  body?: TBody | undefined;
  method: NodeRequestMethod;
  path: string;
  schema: ZodType<TResult>;
}

export type NodeRequester = <TResult, TBody>(options: NodeRequestOptions<TResult, TBody>) => Promise<TResult>;

export type NodeRequestSchema<TResult> = ZodType<TResult>;
