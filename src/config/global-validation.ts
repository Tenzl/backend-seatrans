import { ValidationPipe } from '@nestjs/common';
import { validationFailedException } from '../shared/utils/validate-dto.util';

export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => validationFailedException(errors),
  });
}
