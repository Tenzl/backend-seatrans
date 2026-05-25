import type { ApiErrorBody } from './api-error.dto';

export class ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
  /** Structured error (api-design); present when success === false */
  error?: ApiErrorBody;

  constructor(
    success: boolean,
    message: string,
    data: T | null = null,
    error?: ApiErrorBody,
  ) {
    this.success = success;
    this.message = message;
    this.data = data;
    if (error) {
      this.error = error;
    }
  }

  static success<T>(data: T, message = 'Success'): ApiResponse<T> {
    return new ApiResponse(true, message, data);
  }

  static error(message: string, error?: ApiErrorBody): ApiResponse<null> {
    return new ApiResponse(false, message, null, error);
  }
}
