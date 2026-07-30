import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface TenantSecretEnvelope {
  encryptionKeyId: string;
  valueCiphertext: string;
}

export type TenantSecretEnvironment = Record<string, TenantSecretEnvelope>;

const tenantSecretEnvelopeSchema: ContractSchema<TenantSecretEnvelope> = z
  .object({
    encryptionKeyId: z.string().min(1),
    valueCiphertext: z.string().min(1),
  })
  .strict();

export const tenantSecretEnvironmentSchema: ContractSchema<TenantSecretEnvironment> = z.record(
  z.string(),
  tenantSecretEnvelopeSchema,
);
