export type ApiFieldError = {
  field: string;
  message: string;
  code?: string;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: ApiFieldError[];
};

export function httpStatusToErrorCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation_error';
    case 429:
      return 'rate_limit_exceeded';
    default:
      return status >= 500 ? 'internal_error' : 'request_failed';
  }
}
