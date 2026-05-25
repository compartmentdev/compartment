import { isUnsafePublicIpAddress } from '@compartment/utils';

const publicIpAddressProviderUrls: readonly string[] = ['https://api.ipify.org', 'https://checkip.amazonaws.com'];
const publicIpRequestTimeoutMs: number = 3_000;

export async function readPublicIpAddress(): Promise<string> {
  for (const url of publicIpAddressProviderUrls) {
    const publicIpAddress: string | null = await tryReadPublicIpAddress(url);
    if (publicIpAddress !== null) {
      return publicIpAddress;
    }
  }

  throw new Error(
    'Failed to detect a valid public IP address. Verify outbound internet access or pass --base-domain <domain>.',
  );
}

async function tryReadPublicIpAddress(url: string): Promise<string | null> {
  try {
    const response: Response = await fetch(url, {
      signal: AbortSignal.timeout(publicIpRequestTimeoutMs),
    });
    if (!response.ok) {
      return null;
    }

    return readValidatedPublicIpAddress(await response.text());
  } catch {
    return null;
  }
}

function readValidatedPublicIpAddress(bodyText: string): string | null {
  const candidate: string = bodyText.trim();
  if (isUnsafePublicIpAddress(candidate)) {
    return null;
  }

  return candidate;
}
