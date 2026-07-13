import type { InsertDeploymentProductLogInput } from './deployment-product-logs.query.types';

export const productLogStoreMaxBytes: number = 1_073_741_824;
export const productLogRecordOverheadBytes: number = 1_024;

export function productLogRecordBytes(event: InsertDeploymentProductLogInput): number {
  return Buffer.byteLength(event.message, 'utf8') + productLogRecordOverheadBytes;
}
