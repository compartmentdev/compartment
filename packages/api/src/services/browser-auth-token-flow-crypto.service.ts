import { hasText } from '@compartment/utils';
import {
  decryptVariableValueFromStorage,
  encryptVariableValueForStorage,
  type EncryptedVariableValue,
} from '../lib/variables-crypto';
import { getApiConfig } from '../runtime/runtime-access';
import type {
  BrowserAuthTokenFlowCiphertextAlgorithm,
  BrowserAuthTokenFlowCiphertextEnvelopeV1,
  ParsedBrowserAuthTokenFlowCiphertextEnvelope,
} from './browser-auth-token-flow-crypto.service.types';

const browserAuthTokenFlowCiphertextAlgorithm: BrowserAuthTokenFlowCiphertextAlgorithm = 'compartment-variable-value';

export function encryptBrowserAuthTokenFlowToken(token: string): string {
  const encryptedToken: EncryptedVariableValue = encryptVariableValueForStorage(
    token,
    getApiConfig().variablesMasterKey,
  );

  return JSON.stringify({
    algorithm: browserAuthTokenFlowCiphertextAlgorithm,
    encryptionKeyId: encryptedToken.encryptionKeyId,
    valueCiphertext: encryptedToken.valueCiphertext,
    version: 1,
  });
}

export function decryptBrowserAuthTokenFlowToken(tokenCiphertext: string): string {
  const envelope: BrowserAuthTokenFlowCiphertextEnvelopeV1 = parseBrowserAuthTokenFlowCiphertext(tokenCiphertext);
  return decryptVariableValueFromStorage(
    envelope.valueCiphertext,
    envelope.encryptionKeyId,
    getApiConfig().variablesMasterKey,
  );
}

function parseBrowserAuthTokenFlowCiphertext(tokenCiphertext: string): BrowserAuthTokenFlowCiphertextEnvelopeV1 {
  let parsed: ParsedBrowserAuthTokenFlowCiphertextEnvelope;
  try {
    parsed = JSON.parse(tokenCiphertext) as ParsedBrowserAuthTokenFlowCiphertextEnvelope;
  } catch {
    throw new Error('Browser auth token flow ciphertext is not valid JSON.');
  }

  if (!isBrowserAuthTokenFlowCiphertextEnvelopeV1(parsed)) {
    throw new Error('Browser auth token flow ciphertext has an unsupported envelope format.');
  }

  return parsed;
}

function isBrowserAuthTokenFlowCiphertextEnvelopeV1(
  parsed: ParsedBrowserAuthTokenFlowCiphertextEnvelope | null,
): parsed is BrowserAuthTokenFlowCiphertextEnvelopeV1 {
  return (
    parsed !== null &&
    parsed.version === 1 &&
    parsed.algorithm === browserAuthTokenFlowCiphertextAlgorithm &&
    hasText(parsed.encryptionKeyId) &&
    hasText(parsed.valueCiphertext)
  );
}
