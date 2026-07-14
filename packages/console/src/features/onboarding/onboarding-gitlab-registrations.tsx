import type { GitProviderRegistrationSummary } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { Button } from '../../components/ui/button';

interface GitLabRegistrationChoicesProps {
  onSelect: (registration: GitProviderRegistrationSummary) => void;
  registrations: GitProviderRegistrationSummary[];
}

export function GitLabRegistrationChoices({
  onSelect,
  registrations,
}: Readonly<GitLabRegistrationChoicesProps>): JSX.Element | null {
  if (registrations.length === 0) return null;
  return (
    <div className="grid gap-2">
      <span className="text-[13px] font-medium">Existing registrations</span>
      {registrations.map(
        (registration: GitProviderRegistrationSummary): JSX.Element => (
          <Button
            key={registration.registrationId}
            onClick={(): void => onSelect(registration)}
            type="button"
            variant="outline"
          >
            {registration.providerAccountLogin} · {registration.providerHost} · {renderExpiry(registration.expiresAt)}
          </Button>
        ),
      )}
    </div>
  );
}

function renderExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'does not expire';
  const remainingMs: number = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remainingMs)) return 'expiry date unavailable';
  const label: string = expiresAt.slice(0, 10);
  if (remainingMs <= 0) return `expired ${label} — rotate token`;
  if (remainingMs <= 30 * 86_400_000) return `expires soon: ${label}`;
  return `expires ${label}`;
}
