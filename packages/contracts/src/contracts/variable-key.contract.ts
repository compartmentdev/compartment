import { z } from 'zod';
import type { ContractSchema } from './schema.types';

const variableKeyNamePattern: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const variableKeyNamePatternText: string = '^[A-Za-z_][A-Za-z0-9_]*$';
export const variableKeyNameReservedPrefixRuleText: string = 'must not start with COMPARTMENT_';

export const variableKeyNameSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .refine(
    (keyName: string): boolean => variableKeyNamePattern.test(keyName),
    'Variable names must start with a letter or underscore and contain only letters, digits, and underscores.',
  )
  .refine(
    (keyName: string): boolean => !keyName.startsWith('COMPARTMENT_'),
    'Variable names starting with COMPARTMENT_ are reserved for compartment-managed runtime metadata.',
  );
