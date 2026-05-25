export interface ErrorResponseDetails {
  code: string;
  message: string;
}

export interface ErrorResponsePayload {
  error: ErrorResponseDetails;
}
