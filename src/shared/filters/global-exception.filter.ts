import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiResponse } from '../dto/api-response';
import {
  type ApiErrorBody,
  type ApiFieldError,
  httpStatusToErrorCode,
} from '../dto/api-error.dto';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

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
          details = rawDetails as ApiFieldError[];
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
      const msg = exception.message.toLowerCase();
      if (msg.includes('already exists')) {
        status = HttpStatus.CONFLICT;
        message = exception.message;
      } else if (msg.includes('not found')) {
        status = HttpStatus.NOT_FOUND;
        message = exception.message;
      } else if (
        msg.includes('cannot read properties') ||
        msg.includes('query failed') ||
        msg.includes('connection') ||
        msg.includes('typeorm') ||
        msg.includes('database')
      ) {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'A database error occurred. Please try again.';
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = exception.message || 'Request failed';
      }
    }

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      console.error('[GlobalExceptionFilter]', exception);
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
