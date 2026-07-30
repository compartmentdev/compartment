import { waitForInstallDelay } from './kubernetes-install-delay.service';
import type {
  PublicControlPlaneObservation,
  PublicControlPlaneRequestError,
} from './kubernetes-install-public.service.types';

const publicControlPlanePollIntervalMs: number = 2_000;
const publicControlPlaneRequestTimeoutMs: number = 10_000;
const publicControlPlaneWaitTimeoutMs: number = 5 * 60_000;

export async function waitForPublicControlPlane(apiUrl: string): Promise<void> {
  const deadline: number = Date.now() + publicControlPlaneWaitTimeoutMs;
  let lastFailure: string = 'no response';
  while (Date.now() < deadline) {
    try {
      const observation: PublicControlPlaneObservation = await observePublicControlPlane(apiUrl);
      if (observation.ready) {
        return;
      }
      lastFailure = observation.failure;
    } catch (error) {
      lastFailure = error instanceof Error ? classifyPublicControlPlaneFailure(error) : 'network request failed';
    }
    await waitForInstallDelay(publicControlPlanePollIntervalMs);
  }
  throw new Error(
    `Public Compartment control plane at ${apiUrl} was not ready after 300s: ${lastFailure}. Check DNS, ports 80/443, and the TLS certificate status, then re-run install to resume.`,
  );
}

function classifyPublicControlPlaneFailure(error: Error): string {
  const requestError: PublicControlPlaneRequestError = error as PublicControlPlaneRequestError;
  const code: string = requestError.cause?.code ?? requestError.code ?? '';
  const certificateFailure: string | null = classifyCertificateFailure(code);
  if (certificateFailure !== null) {
    return certificateFailure;
  }
  if (isTlsFailureCode(code)) {
    return `TLS validation failed (${code}): the certificate chain is not trusted by the operator machine. Use a publicly trusted certificate or install the private CA in this machine's trust store`;
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'network connection timed out before the public control plane responded';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `DNS resolution failed (${code}) for the public control plane hostname`;
  }
  return formatGenericNetworkFailure(requestError, code);
}

function classifyCertificateFailure(code: string): string | null {
  if (code === 'CERT_HAS_EXPIRED') {
    return 'TLS validation failed (CERT_HAS_EXPIRED): renew the public control-plane certificate';
  }
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return 'TLS validation failed (ERR_TLS_CERT_ALTNAME_INVALID): the certificate does not cover the public control-plane hostname';
  }
  return null;
}

function formatGenericNetworkFailure(error: PublicControlPlaneRequestError, code: string): string {
  const detail: string = error.cause?.message ?? error.message;
  return `network request failed${code === '' ? '' : ` (${code})`}: ${detail}`;
}

function isTlsFailureCode(code: string): boolean {
  return [
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(code);
}

async function observePublicControlPlane(apiUrl: string): Promise<PublicControlPlaneObservation> {
  const response: Response = await fetch(apiUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(publicControlPlaneRequestTimeoutMs),
  });
  const location: string | null = response.headers.get('location');
  const ready: boolean = response.status === 302 && location === '/login';
  await response.body?.cancel();
  return {
    failure: `HTTP ${response.status.toString()} with location ${location ?? '<none>'}`,
    ready,
  };
}
