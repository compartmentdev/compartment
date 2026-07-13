import { createHmac } from 'node:crypto';

const productLogTokenContext: string = 'compartment-product-log-ingest-v1';

export function deriveProductLogIngestToken(runtimeControlToken: string): string {
  return createHmac('sha256', runtimeControlToken).update(productLogTokenContext).digest('base64url');
}
