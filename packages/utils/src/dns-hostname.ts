const dnsHostnamePattern: RegExp =
  /^(localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/u;

export function normalizeDnsHostname(value: string): string {
  const normalizedValue: string = value.trim().toLowerCase();
  let normalizedLength: number = normalizedValue.length;

  while (normalizedLength > 0 && normalizedValue[normalizedLength - 1] === '.') {
    normalizedLength -= 1;
  }

  return normalizedValue.slice(0, normalizedLength);
}

export function isValidDnsHostname(value: string): boolean {
  return dnsHostnamePattern.test(value);
}
