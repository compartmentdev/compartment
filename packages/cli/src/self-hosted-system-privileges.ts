export function assertSelfHostedSystemPrivileges(): void {
  if (process.getuid?.() === 0) {
    return;
  }

  throw new SelfHostedSystemPrivilegesError();
}

export class SelfHostedSystemPrivilegesError extends Error {
  constructor() {
    super('System self-hosted commands use /etc/compartment and /var/lib/compartment.');
  }
}
