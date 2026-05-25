import {
  listPermissionFamilies,
  type PermissionFamilyDefinition,
  type PermissionKey,
} from '@compartment/contracts/browser';
import type { JSX } from 'react';

interface RolePermissionsSelectionProps {
  isDisabled: boolean;
  selectedPermissions: PermissionKey[];
  setSelectedPermissions: (value: PermissionKey[] | ((current: PermissionKey[]) => PermissionKey[])) => void;
}

interface RolePermissionsCardProps extends RolePermissionsSelectionProps {
  permissionKeys: PermissionKey[];
}

interface RolePermissionFamilyCardProps extends RolePermissionsSelectionProps {
  family: PermissionFamilyDefinition;
}

interface RolePermissionListProps extends RolePermissionsSelectionProps {
  permissionKeys: PermissionKey[];
}

interface RolePermissionRowProps extends RolePermissionsSelectionProps {
  permissionKey: PermissionKey;
}

export function RolePermissionsCard({
  isDisabled,
  permissionKeys,
  selectedPermissions,
  setSelectedPermissions,
}: Readonly<RolePermissionsCardProps>): JSX.Element {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {listVisiblePermissionFamilies(permissionKeys).map(
        (family: PermissionFamilyDefinition): JSX.Element => (
          <RolePermissionFamilyCard
            family={family}
            isDisabled={isDisabled}
            key={family.id}
            selectedPermissions={selectedPermissions}
            setSelectedPermissions={setSelectedPermissions}
          />
        ),
      )}
    </div>
  );
}

function listVisiblePermissionFamilies(permissionKeys: readonly PermissionKey[]): PermissionFamilyDefinition[] {
  const visiblePermissionKeys: ReadonlySet<PermissionKey> = new Set(permissionKeys);
  return listPermissionFamilies()
    .map(
      (family: PermissionFamilyDefinition): PermissionFamilyDefinition => ({
        ...family,
        permissionKeys: family.permissionKeys.filter((permissionKey: PermissionKey): boolean =>
          visiblePermissionKeys.has(permissionKey),
        ),
      }),
    )
    .filter((family: PermissionFamilyDefinition): boolean => family.permissionKeys.length > 0);
}

function RolePermissionFamilyCard({
  family,
  isDisabled,
  selectedPermissions,
  setSelectedPermissions,
}: Readonly<RolePermissionFamilyCardProps>): JSX.Element {
  return (
    <div className="rounded-[14px] border border-[var(--cpt-border-subtle,rgba(0,0,0,0.05))] bg-[var(--cpt-bg-muted,white)] p-3">
      <RolePermissionFamilyHeader family={family} selectedPermissions={selectedPermissions} />
      <RolePermissionFamilyRows
        family={family}
        isDisabled={isDisabled}
        selectedPermissions={selectedPermissions}
        setSelectedPermissions={setSelectedPermissions}
      />
    </div>
  );
}

function RolePermissionFamilyRows(props: Readonly<RolePermissionFamilyCardProps>): JSX.Element {
  return (
    <div className="space-y-1.5">
      <RolePermissionFamilyToggle
        checked={hasEveryPermission(props.family.permissionKeys, props.selectedPermissions)}
        family={props.family}
        isDisabled={props.isDisabled}
        setSelectedPermissions={props.setSelectedPermissions}
      />
      <RolePermissionList
        isDisabled={props.isDisabled}
        permissionKeys={props.family.permissionKeys}
        selectedPermissions={props.selectedPermissions}
        setSelectedPermissions={props.setSelectedPermissions}
      />
    </div>
  );
}

function RolePermissionFamilyHeader({
  family,
  selectedPermissions,
}: Readonly<Pick<RolePermissionFamilyCardProps, 'family' | 'selectedPermissions'>>): JSX.Element {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h4 className="text-[13px] font-semibold leading-[18px] text-[var(--cpt-text-primary,#111212)]">
        {family.label}
      </h4>
      <p className="text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        {readPermissionCountLabel(family, selectedPermissions)}
      </p>
    </div>
  );
}

function RolePermissionFamilyToggle({
  checked,
  family,
  isDisabled,
  setSelectedPermissions,
}: Readonly<
  Pick<RolePermissionFamilyCardProps, 'family' | 'isDisabled' | 'setSelectedPermissions'> & { checked: boolean }
>): JSX.Element {
  return (
    <RolePermissionToggleRow
      checked={checked}
      disabled={isDisabled}
      label="Select all"
      onChange={(): void => {
        togglePermissionFamily(family.permissionKeys, setSelectedPermissions);
      }}
    />
  );
}

function RolePermissionList({
  isDisabled,
  permissionKeys,
  selectedPermissions,
  setSelectedPermissions,
}: Readonly<RolePermissionListProps>): JSX.Element {
  return (
    <div className="space-y-1.5">
      {permissionKeys.map(
        (permissionKey: PermissionKey): JSX.Element => (
          <RolePermissionRow
            isDisabled={isDisabled}
            key={permissionKey}
            permissionKey={permissionKey}
            selectedPermissions={selectedPermissions}
            setSelectedPermissions={setSelectedPermissions}
          />
        ),
      )}
    </div>
  );
}

function RolePermissionRow({
  isDisabled,
  permissionKey,
  selectedPermissions,
  setSelectedPermissions,
}: Readonly<RolePermissionRowProps>): JSX.Element {
  return (
    <RolePermissionToggleRow
      checked={selectedPermissions.includes(permissionKey)}
      disabled={isDisabled}
      label={permissionKey}
      onChange={(): void => {
        togglePermission(permissionKey, setSelectedPermissions);
      }}
    />
  );
}

function RolePermissionToggleRow({
  checked,
  disabled,
  label,
  onChange,
}: Readonly<{ checked: boolean; disabled: boolean; label: string; onChange: () => void }>): JSX.Element {
  return (
    <label className="flex items-center gap-[6px] py-[2px] text-[11px] leading-[14px] tracking-[0.033px] text-black">
      <input
        checked={checked}
        className="size-[14px] rounded-[3px] border border-[var(--cpt-checkbox-border-unchecked,rgba(0,0,0,0.15))] bg-[var(--cpt-checkbox-bg-unchecked,rgba(0,0,0,0.03))] accent-[var(--cpt-primary,#3480c8)]"
        disabled={disabled}
        onChange={onChange}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function readPermissionCountLabel(family: PermissionFamilyDefinition, selectedPermissions: PermissionKey[]): string {
  return `${countSelectedPermissions(family.permissionKeys, selectedPermissions)} selected`;
}

function togglePermission(
  permissionKey: PermissionKey,
  setSelectedPermissions: (value: PermissionKey[] | ((current: PermissionKey[]) => PermissionKey[])) => void,
): void {
  setSelectedPermissions((current: PermissionKey[]): PermissionKey[] =>
    current.includes(permissionKey)
      ? current.filter((value: PermissionKey): boolean => value !== permissionKey)
      : [...current, permissionKey],
  );
}

function togglePermissionFamily(
  permissionKeys: readonly PermissionKey[],
  setSelectedPermissions: (value: PermissionKey[] | ((current: PermissionKey[]) => PermissionKey[])) => void,
): void {
  setSelectedPermissions((current: PermissionKey[]): PermissionKey[] => {
    const isEveryPermissionSelected: boolean = permissionKeys.every((permissionKey: PermissionKey): boolean =>
      current.includes(permissionKey),
    );
    if (isEveryPermissionSelected) {
      return current.filter((permissionKey: PermissionKey): boolean => !permissionKeys.includes(permissionKey));
    }

    return [...new Set([...current, ...permissionKeys])];
  });
}

function hasEveryPermission(permissionKeys: readonly PermissionKey[], selectedPermissions: PermissionKey[]): boolean {
  return permissionKeys.every((permissionKey: PermissionKey): boolean => selectedPermissions.includes(permissionKey));
}

function countSelectedPermissions(
  permissionKeys: readonly PermissionKey[],
  selectedPermissions: PermissionKey[],
): number {
  return permissionKeys.filter((permissionKey: PermissionKey): boolean => selectedPermissions.includes(permissionKey))
    .length;
}
