export interface NodeCondition {
  lastTransitionTime?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
}

export interface NodeMetadataPayload {
  name?: string | undefined;
}

export interface NodeStatusPayload {
  conditions?: NodeCondition[] | undefined;
}

export interface NodePayload {
  metadata?: NodeMetadataPayload | undefined;
  status?: NodeStatusPayload | undefined;
}

export interface NodeListPayload {
  items?: NodePayload[] | undefined;
}
