import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { getApiConfig } from '../../runtime/runtime-access';

export function createSourceArchiveTooLargeBoundaryError(code: string): ApiBoundaryError {
  return new ApiBoundaryError(
    413,
    code,
    `Source archive must not exceed ${getApiConfig().sourceArchiveMaxBytes} bytes.`,
  );
}
