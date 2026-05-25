import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type CompartmentServiceKind = 'web' | 'api' | 'static' | 'worker' | 'job' | 'cron';
export const compartmentServiceKindValues: readonly [
  CompartmentServiceKind,
  CompartmentServiceKind,
  CompartmentServiceKind,
  CompartmentServiceKind,
  CompartmentServiceKind,
  CompartmentServiceKind,
] = ['web', 'api', 'static', 'worker', 'job', 'cron'];

const defaultCompartmentServiceKind: CompartmentServiceKind = 'web';
const deployableCompartmentServiceKindValues: readonly CompartmentServiceKind[] = ['web', 'api', 'static'];
const routableCompartmentServiceKindValues: readonly CompartmentServiceKind[] = ['web', 'api', 'static'];

export const compartmentServiceKindSchema: ContractSchema<CompartmentServiceKind> =
  z.enum(compartmentServiceKindValues);

export function resolveCompartmentServiceKind(kind: CompartmentServiceKind | undefined): CompartmentServiceKind {
  return kind ?? defaultCompartmentServiceKind;
}

export function isDeployableCompartmentServiceKind(kind: CompartmentServiceKind): boolean {
  return deployableCompartmentServiceKindValues.includes(kind);
}

export function isRoutableCompartmentServiceKind(kind: CompartmentServiceKind): boolean {
  return routableCompartmentServiceKindValues.includes(kind);
}
