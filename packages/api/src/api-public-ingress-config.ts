import { isIP } from 'node:net';
import { z } from 'zod';

interface ApiPublicIngressConfigEnv {
  COMPARTMENT_PUBLIC_INGRESS_IPV4: string;
  COMPARTMENT_PUBLIC_INGRESS_IPV6: string;
}

export interface ApiPublicIngressConfig {
  publicIngressIpv4: string | null;
  publicIngressIpv6: string | null;
}

const apiPublicIngressConfigSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_PUBLIC_INGRESS_IPV4: z.string(),
  COMPARTMENT_PUBLIC_INGRESS_IPV6: z.string(),
});

export function readApiPublicIngressConfig(env: NodeJS.ProcessEnv = process.env): ApiPublicIngressConfig {
  const parsed: ApiPublicIngressConfigEnv = apiPublicIngressConfigSchema.parse(env) as ApiPublicIngressConfigEnv;

  return {
    publicIngressIpv4: parsePublicIngressIp(
      parsed.COMPARTMENT_PUBLIC_INGRESS_IPV4,
      4,
      'COMPARTMENT_PUBLIC_INGRESS_IPV4',
    ),
    publicIngressIpv6: parsePublicIngressIp(
      parsed.COMPARTMENT_PUBLIC_INGRESS_IPV6,
      6,
      'COMPARTMENT_PUBLIC_INGRESS_IPV6',
    ),
  };
}

function parsePublicIngressIp(value: string, version: 4 | 6, variableName: string): string | null {
  const normalizedValue: string = value.trim();
  if (normalizedValue === '') {
    return null;
  }
  if (isIP(normalizedValue) !== version) {
    throw new Error(`${variableName} must be empty or a valid IPv${version} address.`);
  }

  return normalizedValue;
}
