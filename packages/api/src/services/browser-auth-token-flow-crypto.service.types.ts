export type BrowserAuthTokenFlowCiphertextAlgorithm = 'compartment-variable-value';

export interface BrowserAuthTokenFlowCiphertextEnvelopeV1 {
  algorithm: BrowserAuthTokenFlowCiphertextAlgorithm;
  encryptionKeyId: string;
  valueCiphertext: string;
  version: 1;
}

export interface ParsedBrowserAuthTokenFlowCiphertextEnvelope {
  algorithm?: string | undefined;
  encryptionKeyId?: string | undefined;
  valueCiphertext?: string | undefined;
  version?: number | undefined;
}
