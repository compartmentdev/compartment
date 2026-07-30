export interface Aes256GcmEnvelopeV1 {
  algorithm: 'aes-256-gcm';
  ciphertext: string;
  dekWrapIv: string;
  dekWrapTag: string;
  valueIv: string;
  valueTag: string;
  version: 1;
  wrappedDek: string;
}

export interface Aes256GcmEnvelopeCiphertext {
  ciphertext: string;
  keyId: string;
}

export interface ParsedAes256GcmEnvelope {
  algorithm?: string;
  ciphertext?: string;
  dekWrapIv?: string;
  dekWrapTag?: string;
  valueIv?: string;
  valueTag?: string;
  version?: number;
  wrappedDek?: string;
}
