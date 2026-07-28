export function readManagedDomainReservationToken(env: NodeJS.ProcessEnv = process.env): string {
  const token: string | undefined = env.COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN;
  if (token === undefined || token.trim() === '') {
    throw new Error('COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN is required for a managed-domain reservation.');
  }
  return token;
}
