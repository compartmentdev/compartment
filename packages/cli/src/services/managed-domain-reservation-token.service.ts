const publicManagedDomainInstallCommand: string =
  'curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-install';

export function assertManagedDomainOnboardingAvailable(env: NodeJS.ProcessEnv = process.env): void {
  if (!hasManagedDomainReservationToken(env)) {
    throw new Error(
      'Managed Compartment domains require onboarding through the public installer. ' +
        `Start the supported onboarding flow with:\n  ${publicManagedDomainInstallCommand}\n` +
        'This starts the installer hand-off to the guided installation. ' +
        'Alternatively, choose domain option 2 and provide an operator-owned base domain.',
    );
  }
}

export function readManagedDomainReservationToken(env: NodeJS.ProcessEnv = process.env): string {
  const token: string | undefined = env.COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN;
  if (token === undefined || token.trim() === '') {
    throw new Error(
      'Managed-domain onboarding authorization is no longer available. The namespace and foundation Helm release ' +
        'may already exist. Resume through the public onboarding flow, using the same context, namespace, and release:\n  ' +
        `${publicManagedDomainInstallCommand}\n` +
        'To roll back instead, run ' +
        '`helm uninstall <release> --namespace <namespace> --kube-context <context>`, then run ' +
        '`kubectl --context <context> delete namespace <namespace>` only if that namespace was created exclusively ' +
        'for Compartment.',
    );
  }
  return token;
}

function hasManagedDomainReservationToken(env: NodeJS.ProcessEnv): boolean {
  const token: string | undefined = env.COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN;
  return token !== undefined && token.trim() !== '';
}
