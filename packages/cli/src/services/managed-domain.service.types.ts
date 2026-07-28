import type { ManagedDomainReservationRequest, ManagedDomainTargetBindingRequest } from '@compartment/contracts';

export interface ManagedDomainReservationInput extends ManagedDomainReservationRequest {
  brokerUrl: string;
  reservationToken: string;
}

export interface ManagedDomainBindingInput extends ManagedDomainTargetBindingRequest {
  allocationId: string;
  brokerUrl: string;
  scopedToken: string;
}
