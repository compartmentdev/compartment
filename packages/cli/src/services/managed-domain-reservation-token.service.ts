export function readManagedDomainReservationToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token: string | undefined = env.COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN;
  if (token === undefined || token.trim() === '') {
    return undefined;
  }
  return token;
}
