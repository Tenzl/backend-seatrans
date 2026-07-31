import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GlobalExceptionFilter } from './global-exception.filter';

function httpHost() {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  const request = {
    method: 'POST',
    originalUrl: '/api/v1/example?code=oauth-one-time-code',
  } as Request;
  const response = { status, json } as unknown as Response;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('never exposes an internal HttpException message in the response', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { host, status, json } = httpHost();

    new GlobalExceptionFilter().catch(
      new InternalServerErrorException(
        'database password=top-secret connection failed',
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error',
      data: null,
      error: {
        code: 'internal_error',
        message: 'Internal server error',
      },
    });
    const logged = JSON.stringify(logger.mock.calls);
    expect(logged).not.toContain('top-secret');
    expect(logged).not.toContain('oauth-one-time-code');
    expect(logged).toContain('<redacted>');
  });

  it('preserves safe client validation details and maps them to 422', () => {
    const { host, status, json } = httpHost();

    new GlobalExceptionFilter().catch(
      new BadRequestException({
        message: 'Request validation failed',
        details: [
          {
            field: 'name',
            message: 'name must be a string',
            ignoredInternalProperty: 'must-not-leak',
          },
        ],
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Request validation failed',
      data: null,
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: [{ field: 'name', message: 'name must be a string' }],
      },
    });
  });
});
