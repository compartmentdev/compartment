interface AuthSessionTokenResponse {
  sessionToken?: string | undefined;
}

export function requireAuthSessionToken(response: AuthSessionTokenResponse, errorMessage: string): string {
  if (response.sessionToken === undefined) {
    throw new Error(errorMessage);
  }

  return response.sessionToken;
}
