export interface PublicControlPlaneObservation {
  failure: string;
  ready: boolean;
}

export interface PublicControlPlaneRequestError extends Error {
  cause?: PublicControlPlaneRequestErrorCause | undefined;
  code?: string | undefined;
}

interface PublicControlPlaneRequestErrorCause {
  code?: string | undefined;
  message?: string | undefined;
}
