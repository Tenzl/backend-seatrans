import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiResponse } from '../dto/api-response';
import {
  type ApiErrorBody,
  type ApiFieldError,
  httpStatusToErrorCode,
} from '../dto/api-error.dto';
import {
  redactSensitiveText,
  safeErrorForLog,
} from '../logging/safe-error-log';

function sanitizeFieldErrors(value: unknown): ApiFieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const details: ApiFieldError[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const field = record.field;
    const message = record.message;
    const code = record.code;
    if (typeof field !== 'string' || typeof message !== 'string') continue;
    details.push({
      field,
      message,
      ...(typeof code === 'string' ? { code } : {}),
    });
  }
  return details.length ? details : undefined;
}

function publicServerErrorMessage(status: number): string {
  if (status === 503) {
    return 'Service temporarily unavailable';
  }
  if (status === 504) {
    return 'Upstream service timed out';
  }
  if (status === 502) {
    return 'Upstream service unavailable';
  }
  return 'Internal server error';
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: ApiFieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        const rawMessage = body.message;
        const rawDetails = body.details;

        if (Array.isArray(rawDetails)) {
          details = sanitizeFieldErrors(rawDetails);
          message =
            typeof rawMessage === 'string'
              ? rawMessage
              : 'Request validation failed';
          if (status === HttpStatus.BAD_REQUEST) {
            status = HttpStatus.UNPROCESSABLE_ENTITY;
          }
        } else if (Array.isArray(rawMessage)) {
          message =
            typeof rawMessage[0] === 'string'
              ? rawMessage[0]
              : 'Request validation failed';
          details = rawMessage.map((entry, index) => {
            if (typeof entry === 'string') {
              return { field: String(index), message: entry };
            }
            return {
              field: 'request',
              message: String(entry),
            };
          });
          if (status === HttpStatus.BAD_REQUEST) {
            status = HttpStatus.UNPROCESSABLE_ENTITY;
          }
        } else if (typeof rawMessage === 'string') {
          message = rawMessage;
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const method = request?.method ?? 'UNKNOWN';
      const path = (
        request?.path ??
        request?.originalUrl ??
        request?.url ??
        'unknown'
      ).split('?')[0];
      const safeError = safeErrorForLog(exception);
      const summary = redactSensitiveText(
        `${method} ${path} -> ${status} ${safeError.message}`,
      );
      this.logger.error(summary, safeError.stack);
      message = publicServerErrorMessage(status);
      details = undefined;
    }

    const code = httpStatusToErrorCode(status);
    const errorBody: ApiErrorBody = {
      code,
      message,
      ...(details?.length ? { details } : {}),
    };

    response.status(status).json(ApiResponse.error(message, errorBody));
  }
}
