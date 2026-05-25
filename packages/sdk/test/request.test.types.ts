import type { CompartmentRequestErrorFields } from '../src/http/request.types';

export interface ErrorResponseDetails {
  code: string;
  message: string;
}

export interface ErrorResponsePayload {
  error: ErrorResponseDetails;
}

export type CompartmentRequestErrorShape = Error & CompartmentRequestErrorFields;
