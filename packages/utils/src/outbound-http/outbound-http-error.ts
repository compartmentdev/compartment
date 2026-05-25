export class OutboundHttpPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OutboundHttpPolicyError';
  }
}
