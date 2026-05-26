import {
  listPermissionFamilies,
  type PermissionFamilyDefinition,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { useState, type JSX } from 'react';
import { cn } from '../../lib/utils';

interface PermissionFamiliesCardProps {
  permissionKeys: PermissionKey[];
}

interface PermissionFamilyCardViewModel {
  activePermissionKeys: PermissionKey[];
  id: string;
  label: string;
  permissionKeys: PermissionKey[];
}

export function PermissionFamiliesCard(props: Readonly<PermissionFamiliesCardProps>): JSX.Element {
  return <PermissionFamiliesSection {...props} />;
}

function PermissionFamiliesSection({ permissionKeys }: Readonly<PermissionFamiliesCardProps>): JSX.Element {
  if (permissionKeys.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No effective permissions.</p>;
  }

  const families: PermissionFamilyCardViewModel[] = readPermissionFamilyCards(permissionKeys);

  return (
    <div className="space-y-3">
      {families.map(
        (family: PermissionFamilyCardViewModel): JSX.Element => (
          <PermissionFamilyCard family={family} key={family.id} />
        ),
      )}
    </div>
  );
}

function PermissionFamilyCard({ family }: Readonly<{ family: PermissionFamilyCardViewModel }>): JSX.Element {
  return (
    <div className="rounded-[10px] border border-[var(--cpt-border-default,rgba(0,0,0,0.08))] bg-[var(--cpt-bg-card,#fafafa)] px-3 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h4 className="text-[13px] font-semibold">{family.label}</h4>
        <span className="text-[12px] text-[var(--cpt-text-muted,#8f98a1)]">
          {readPermissionCountLabel(family.activePermissionKeys.length)}
        </span>
      </div>
      <PermissionFamilyBadges permissionKeys={family.activePermissionKeys} />
    </div>
  );
}

function PermissionFamilyBadges({ permissionKeys }: Readonly<{ permissionKeys: PermissionKey[] }>): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const visiblePermissionKeys: PermissionKey[] = isExpanded
    ? readExpandedPermissionKeys(permissionKeys)
    : readCollapsedPermissionKeys(permissionKeys);
  const hiddenCount: number = permissionKeys.length - visiblePermissionKeys.length;
  const canExpand: boolean = permissionKeys.length > 3;

  return (
    <div className="flex flex-wrap gap-2">
      {visiblePermissionKeys.map(
        (permissionKey: PermissionKey): JSX.Element => (
          <PermissionBadge key={permissionKey} permissionKey={permissionKey} />
        ),
      )}
      {canExpand ? (
        <PermissionFamilyToggle
          hiddenCount={hiddenCount}
          onToggle={(): void => setIsExpanded((value: boolean): boolean => !value)}
        />
      ) : null}
    </div>
  );
}

function PermissionBadge({ permissionKey }: Readonly<{ permissionKey: PermissionKey }>): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full border border-[var(--cpt-tag-border-default,rgba(17,18,18,0.18))] bg-[var(--cpt-tag-bg-default,rgba(0,0,0,0.06))] px-2 text-[11px] font-medium leading-none text-[var(--cpt-text-secondary,#485259)]',
      )}
    >
      {permissionKey}
    </span>
  );
}

function PermissionFamilyToggle({
  hiddenCount,
  onToggle,
}: Readonly<{ hiddenCount: number; onToggle: () => void }>): JSX.Element {
  return (
    <button
      className="cursor-pointer text-[12px] text-[var(--cpt-link,#2b6fe8)] hover:underline"
      onClick={onToggle}
      type="button"
    >
      {hiddenCount > 0 ? `+${hiddenCount} more` : 'Show less'}
    </button>
  );
}

function readCollapsedPermissionKeys(permissionKeys: PermissionKey[]): PermissionKey[] {
  return permissionKeys.slice(0, 3);
}

function readExpandedPermissionKeys(permissionKeys: PermissionKey[]): PermissionKey[] {
  return permissionKeys;
}

function readPermissionCountLabel(count: number): string {
  return count === 1 ? '1 permission' : `${count} permissions`;
}

function readPermissionFamilyCards(permissionKeys: readonly PermissionKey[]): PermissionFamilyCardViewModel[] {
  return listPermissionFamilies().map(toPermissionFamilyCardViewModel(permissionKeys)).filter(hasActivePermissionKeys);
}

function toPermissionFamilyCardViewModel(
  permissionKeys: readonly PermissionKey[],
): (family: PermissionFamilyDefinition) => PermissionFamilyCardViewModel {
  return (family: PermissionFamilyDefinition): PermissionFamilyCardViewModel => ({
    ...family,
    activePermissionKeys: family.permissionKeys.filter((permissionKey: PermissionKey): boolean =>
      permissionKeys.includes(permissionKey),
    ),
  });
}

function hasActivePermissionKeys(family: PermissionFamilyCardViewModel): boolean {
  return family.activePermissionKeys.length > 0;
}
