import type { ProductLogIngestEvent } from '@compartment/contracts';

export const productLogStoreMaxBytes: number = 1_073_741_824;
export const productLogRecordOverheadBytes: number = 1_024;

export function productLogRecordBytes(event: ProductLogIngestEvent): number {
  return Buffer.byteLength(event.message, 'utf8') + productLogRecordOverheadBytes;
}
