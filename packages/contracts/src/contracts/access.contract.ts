import { z } from 'zod';
import {
  accessAssignmentScopeTypeValues,
  accessSummaryLabelValues,
  compartmentMembershipRoleValues,
  friendlyAccessSummaryByRole,
  permissionFamilyDefinitions,
  permissionKeyValues,
  permissionKeysByCompartmentMembershipRole,
} from './access.contract.constants';
import type {
  AccessAssignmentScopeType,
  AccessRoleKind,
  AccessSummaryLabel,
  AppAccessScopeType,
  AppRouteAccessMode,
  CompartmentMembershipRole,
  PermissionFamilyDefinition,
  PermissionKey,
} from './access.contract.types';
import type { ContractSchema } from './schema.types';

export type {
  AccessAssignmentScopeType,
  AccessRoleKind,
  AccessSummaryLabel,
  AppAccessScopeType,
  AppRouteAccessMode,
  CompartmentMembershipRole,
  PermissionFamilyDefinition,
  PermissionKey,
} from './access.contract.types';
export type { AppAccessScopeType as CompartmentAccessScopeType } from './access.contract.types';

export const appAccessScopeTypeSchema: ContractSchema<AppAccessScopeType> = z.enum(accessAssignmentScopeTypeValues);
export const accessAssignmentScopeTypeSchema: ContractSchema<AccessAssignmentScopeType> = z.enum(
  accessAssignmentScopeTypeValues,
);
export const compartmentMembershipRoleSchema: ContractSchema<CompartmentMembershipRole> = z.enum(
  compartmentMembershipRoleValues,
);
export const accessRoleKindSchema: ContractSchema<AccessRoleKind> = z.enum(['custom', 'system']);
export const accessSummaryLabelSchema: ContractSchema<AccessSummaryLabel> = z.enum(accessSummaryLabelValues);
export const permissionKeySchema: ContractSchema<PermissionKey> = z.enum(permissionKeyValues);
export const appRouteAccessModeSchema: ContractSchema<AppRouteAccessMode> = z.enum(['authenticated', 'public']);

export const defaultAppRouteAccessMode: AppRouteAccessMode = 'authenticated';

export function listCompartmentRolePermissions(role: CompartmentMembershipRole): PermissionKey[] {
  return [...permissionKeysByCompartmentMembershipRole[role]];
}

export function listPermissionKeys(): PermissionKey[] {
  return [...permissionKeyValues];
}

export function listPermissionFamilies(): PermissionFamilyDefinition[] {
  return permissionFamilyDefinitions.map(clonePermissionFamilyDefinition);
}

export function readPermissionFamily(permissionKey: PermissionKey): PermissionFamilyDefinition {
  const family: PermissionFamilyDefinition | undefined = permissionFamilyDefinitions.find(
    (entry: PermissionFamilyDefinition): boolean => entry.permissionKeys.includes(permissionKey),
  );
  if (family === undefined) {
    throw new Error(`Unknown permission family for ${permissionKey}.`);
  }
  return clonePermissionFamilyDefinition(family);
}

export function readFriendlyAccessSummary(permissionKeys: readonly PermissionKey[]): AccessSummaryLabel {
  const normalizedPermissionKeys: PermissionKey[] = normalizePermissionKeys(permissionKeys);
  if (normalizedPermissionKeys.length === 0) {
    return 'Membership only';
  }
  for (const role of compartmentMembershipRoleValues) {
    if (matchesPermissionSet(normalizedPermissionKeys, permissionKeysByCompartmentMembershipRole[role])) {
      return friendlyAccessSummaryByRole[role];
    }
  }
  return 'Custom';
}

function clonePermissionFamilyDefinition(family: PermissionFamilyDefinition): PermissionFamilyDefinition {
  return { id: family.id, label: family.label, permissionKeys: [...family.permissionKeys] };
}

function matchesPermissionSet(left: readonly PermissionKey[], right: readonly PermissionKey[]): boolean {
  const normalizedRight: PermissionKey[] = normalizePermissionKeys(right);
  return (
    left.length === normalizedRight.length &&
    left.every((permissionKey: PermissionKey, index: number): boolean => permissionKey === normalizedRight[index])
  );
}

function normalizePermissionKeys(permissionKeys: readonly PermissionKey[]): PermissionKey[] {
  return [...new Set(permissionKeys)].sort((left: string, right: string): number => left.localeCompare(right));
}
