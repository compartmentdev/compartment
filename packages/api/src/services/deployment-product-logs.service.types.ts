export interface ProductLogIngestResult {
  accepted: number;
  deferred?: number;
  duplicates: number;
  rejected: number;
}
