import selfHostedRuntimeImageSignaturePolicyJson from './self-hosted-runtime-image-signature-policy.json';

export interface SelfHostedRuntimeImageSignaturePolicy {
  readonly cosignBundleFormatFlag: '--new-bundle-format';
  readonly certificateOidcIssuer: string;
  readonly certificateIdentityRegexp: string;
}

export const selfHostedRuntimeImageSignaturePolicy: SelfHostedRuntimeImageSignaturePolicy =
  selfHostedRuntimeImageSignaturePolicyJson as SelfHostedRuntimeImageSignaturePolicy;
