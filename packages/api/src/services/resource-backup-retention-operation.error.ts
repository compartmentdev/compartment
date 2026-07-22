export class ResourceBackupRetentionOperationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResourceBackupRetentionOperationError';
  }
}
