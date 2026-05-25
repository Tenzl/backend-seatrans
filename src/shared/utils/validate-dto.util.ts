import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): Array<{ field: string; message: string }> {
  const result: Array<{ field: string; message: string }> = [];

  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;

    if (error.constraints) {
      result.push({
        field,
        message: Object.values(error.constraints)[0],
      });
    }

    if (error.children?.length) {
      result.push(...flattenValidationErrors(error.children, field));
    }
  }

  return result;
}

/** Run class-validator on a plain object (e.g. parsed multipart JSON). */
export async function validateDto<T extends object>(
  dtoClass: new () => T,
  plain: object,
): Promise<T> {
  const instance = plainToInstance(dtoClass, plain, {
    enableImplicitConversion: true,
  });

  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });

  if (errors.length > 0) {
    const details = flattenValidationErrors(errors);
    throw new BadRequestException({
      message: 'Request validation failed',
      details,
    });
  }

  return instance;
}
