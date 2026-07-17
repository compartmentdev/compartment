import selfHostedRuntimeImageSignaturePolicyJson from './self-hosted-runtime-image-signature-policy.json';

export interface SelfHostedRuntimeImageSignaturePolicy {
  readonly certificateIdentityRegexp: string;
  readonly certificateOidcIssuer: string;
  readonly cosignBundleFormatFlag: '--new-bundle-format';
}

export const selfHostedRuntimeImageSignaturePolicy: SelfHostedRuntimeImageSignaturePolicy =
  selfHostedRuntimeImageSignaturePolicyJson as SelfHostedRuntimeImageSignaturePolicy;
