import type {
  CliLoginExchangeRequest,
  CliLoginExchangeResponse,
  CliLoginStartRequest,
  CliLoginStartResponse,
  CliLoginStatusRequest,
  CliLoginStatusResponse,
} from '@compartment/contracts';
import {
  exchangeCliLogin as exchangeCompartmentCliLogin,
  getCliLoginStatus as getCompartmentCliLoginStatus,
  startCliLogin as startCompartmentCliLogin,
} from '@compartment/sdk';
import type { ApiContext } from './context.types';
import { createApiRequester } from './context.service';

export async function startCliLogin(context: ApiContext, input: CliLoginStartRequest): Promise<CliLoginStartResponse> {
  return await startCompartmentCliLogin(createApiRequester(context.apiUrl), input);
}

export async function getCliLoginStatus(
  context: ApiContext,
  input: CliLoginStatusRequest,
): Promise<CliLoginStatusResponse> {
  return await getCompartmentCliLoginStatus(createApiRequester(context.apiUrl), input);
}

export async function exchangeCliLogin(
  context: ApiContext,
  input: CliLoginExchangeRequest,
): Promise<CliLoginExchangeResponse> {
  return await exchangeCompartmentCliLogin(createApiRequester(context.apiUrl), input);
}
