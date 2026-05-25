import type { Response } from '@playwright/test';

export function isSuccessfulApiResponse(response: Response, pathname: string): boolean {
  const responseUrl: URL = new URL(response.url());
  return responseUrl.pathname === pathname && response.status() === 200;
}

export function isSuccessfulApiMutationResponse(response: Response, pathname: string, method: string): boolean {
  return isSuccessfulApiResponse(response, pathname) && response.request().method() === method;
}
