import {
  cliLoginExchangeRequestSchema,
  cliLoginExchangeResponseSchema,
  cliLoginStartRequestSchema,
  cliLoginStartResponseSchema,
  cliLoginStatusRequestSchema,
  cliLoginStatusResponseSchema,
  compartmentAuthCliExchangePathname,
  compartmentAuthCliStartPathname,
  compartmentAuthCliStatusPathname,
  type CliLoginExchangeRequest,
  type CliLoginExchangeResponse,
  type CliLoginStartRequest,
  type CliLoginStartResponse,
  type CliLoginStatusRequest,
  type CliLoginStatusResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function startCliLogin(
  request: CompartmentRequester,
  body: CliLoginStartRequest,
): Promise<CliLoginStartResponse> {
  return await request<CliLoginStartResponse, CliLoginStartRequest>({
    body: cliLoginStartRequestSchema.parse(body),
    method: 'POST',
    path: compartmentAuthCliStartPathname,
    schema: cliLoginStartResponseSchema,
  });
}

export async function getCliLoginStatus(
  request: CompartmentRequester,
  body: CliLoginStatusRequest,
): Promise<CliLoginStatusResponse> {
  return await request<CliLoginStatusResponse, CliLoginStatusRequest>({
    body: cliLoginStatusRequestSchema.parse(body),
    method: 'POST',
    path: compartmentAuthCliStatusPathname,
    schema: cliLoginStatusResponseSchema,
  });
}

export async function exchangeCliLogin(
  request: CompartmentRequester,
  body: CliLoginExchangeRequest,
): Promise<CliLoginExchangeResponse> {
  return await request<CliLoginExchangeResponse, CliLoginExchangeRequest>({
    body: cliLoginExchangeRequestSchema.parse(body),
    method: 'POST',
    path: compartmentAuthCliExchangePathname,
    schema: cliLoginExchangeResponseSchema,
  });
}
