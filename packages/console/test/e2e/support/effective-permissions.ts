import {
  listPermissionFamilies,
  type PermissionFamilyDefinition,
  type PermissionKey,
} from '@compartment/contracts/browser';

export function readVisibleEffectivePermissionKeys(permissionKeys: PermissionKey[]): PermissionKey[] {
  return listPermissionFamilies().flatMap((family: PermissionFamilyDefinition): PermissionKey[] => {
    const activePermissionKeys: PermissionKey[] = family.permissionKeys.filter(
      (permissionKey: PermissionKey): boolean => permissionKeys.includes(permissionKey),
    );

    return activePermissionKeys.slice(0, 3);
  });
}
