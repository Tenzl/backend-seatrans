import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { flattenValidationErrors } from '../shared/utils/validate-dto.util';

export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Request validation failed',
        details: flattenValidationErrors(errors),
      }),
  });
}
